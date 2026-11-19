// SPDX-License-Identifier: AGPL-3.0-only
//
// altyazi-rp: chiaki-ng çekirdeğini Electron'a bağlayan küçük yardımcı süreç.
// Android'deki remoteplay_jni.c'nin masaüstü karşılığı; aynı çağrılar, aynı izleyici modu
// (ses yok, kontrolcü/mikrofon duyurusu yok, giriş gönderilmez).
//
// Protokol
//   stdin  : satır başına bir komut, boşlukla ayrılmış alanlar (anahtarlar base64):
//     discover <send_host> <ping_ms>        discover_stop
//     wakeup <host> <ps5 0|1> <regist_key_b64>
//     regist <host> <ps5 0|1> <broadcast 0|1> <account_id_b64> <pin>    regist_stop
//     session <host> <ps5 0|1> <regist_key_b64> <morning_b64> <account_id_b64> <res 1-4> <fps 30|60> <codec 0|1>
//     session_stop     idr     quit
//   stdout : ikili paketler  [tip:1][uzunluk:4 LE][veri]
//     'J' = UTF-8 JSON olay   'V' = video örneği: [frames_lost:4 LE][H.264/H.265 Annex-B]
// stdin kapanırsa (Electron kapandı) her şey durdurulup çıkılır.

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#include <fcntl.h>
#include <io.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#endif

#include <chiaki/base64.h>
#include <chiaki/common.h>
#include <chiaki/discovery.h>
#include <chiaki/discoveryservice.h>
#include <chiaki/log.h>
#include <chiaki/regist.h>
#include <chiaki/session.h>
#include <chiaki/thread.h>

// ======================================================================== çıktı

static ChiakiMutex g_out_mutex;

static void write_packet(char type, const void *a, uint32_t a_size, const void *b, uint32_t b_size)
{
	uint32_t total = a_size + b_size;
	uint8_t hdr[5] = { (uint8_t)type, (uint8_t)(total & 0xff), (uint8_t)((total >> 8) & 0xff),
		(uint8_t)((total >> 16) & 0xff), (uint8_t)((total >> 24) & 0xff) };
	chiaki_mutex_lock(&g_out_mutex);
	fwrite(hdr, 1, sizeof(hdr), stdout);
	if(a_size)
		fwrite(a, 1, a_size, stdout);
	if(b_size)
		fwrite(b, 1, b_size, stdout);
	fflush(stdout);
	chiaki_mutex_unlock(&g_out_mutex);
}

typedef struct
{
	char *p;
	size_t len, cap;
} Buf;

static void buf_put(Buf *b, const char *s, size_t n)
{
	if(b->len + n + 1 > b->cap)
	{
		size_t cap = b->cap ? b->cap : 256;
		while(cap < b->len + n + 1)
			cap *= 2;
		char *p = realloc(b->p, cap);
		if(!p)
			return;
		b->p = p;
		b->cap = cap;
	}
	memcpy(b->p + b->len, s, n);
	b->len += n;
	b->p[b->len] = '\0';
}

static void buf_raw(Buf *b, const char *s) { buf_put(b, s, strlen(s)); }

static void buf_fmt(Buf *b, const char *fmt, ...)
{
	char tmp[128];
	va_list ap;
	va_start(ap, fmt);
	int n = vsnprintf(tmp, sizeof(tmp), fmt, ap);
	va_end(ap);
	if(n > 0)
		buf_put(b, tmp, (size_t)n < sizeof(tmp) ? (size_t)n : sizeof(tmp) - 1);
}

/** JSON metni; NULL -> null. UTF-8 baytları olduğu gibi geçer. */
static void buf_str(Buf *b, const char *s)
{
	if(!s)
	{
		buf_raw(b, "null");
		return;
	}
	buf_raw(b, "\"");
	for(const unsigned char *c = (const unsigned char *)s; *c; c++)
	{
		if(*c == '"' || *c == '\\')
		{
			char esc[2] = { '\\', (char)*c };
			buf_put(b, esc, 2);
		}
		else if(*c < 0x20)
			buf_fmt(b, "\\u%04x", *c);
		else
			buf_put(b, (const char *)c, 1);
	}
	buf_raw(b, "\"");
}

static void buf_b64(Buf *b, const void *data, size_t size)
{
	char out[128];
	if(chiaki_base64_encode((const uint8_t *)data, size, out, sizeof(out)) != CHIAKI_ERR_SUCCESS)
		out[0] = '\0';
	buf_str(b, out);
}

static void emit(Buf *b)
{
	if(b->p)
		write_packet('J', b->p, (uint32_t)b->len, NULL, 0);
	free(b->p);
	b->p = NULL;
	b->len = b->cap = 0;
}

static void emit_error(const char *ev, const char *msg)
{
	Buf b = { 0 };
	buf_raw(&b, "{\"ev\":");
	buf_str(&b, ev);
	buf_raw(&b, ",\"ok\":false,\"error\":");
	buf_str(&b, msg);
	buf_raw(&b, "}");
	emit(&b);
}

static void log_cb(ChiakiLogLevel level, const char *msg, void *user)
{
	(void)user;
	const char *lv = "D";
	switch(level)
	{
		case CHIAKI_LOG_ERROR: lv = "E"; break;
		case CHIAKI_LOG_WARNING: lv = "W"; break;
		case CHIAKI_LOG_INFO: lv = "I"; break;
		default: break;
	}
	Buf b = { 0 };
	buf_raw(&b, "{\"ev\":\"log\",\"level\":\"");
	buf_raw(&b, lv);
	buf_raw(&b, "\",\"msg\":");
	buf_str(&b, msg);
	buf_raw(&b, "}");
	emit(&b);
}

#define LOG_LEVELS (CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING | CHIAKI_LOG_INFO)

static bool b64_exact(const char *in, void *out, size_t size)
{
	if(!in)
		return false;
	uint8_t tmp[64];
	size_t n = sizeof(tmp);
	if(chiaki_base64_decode(in, strlen(in), tmp, &n) != CHIAKI_ERR_SUCCESS || n != size)
		return false;
	memcpy(out, tmp, size);
	return true;
}

// ======================================================================== discovery

typedef struct
{
	bool active;
	ChiakiDiscoveryService service;
	ChiakiLog log;
} Discovery;

static Discovery g_discovery;

// Konsol listesi her ping turunda (değişmese de) gelir.
static void discovery_cb(ChiakiDiscoveryHost *hosts, size_t count, void *user)
{
	(void)user;
	Buf b = { 0 };
	buf_raw(&b, "{\"ev\":\"hosts\",\"hosts\":[");
	for(size_t i = 0; i < count; i++)
	{
		if(i)
			buf_raw(&b, ",");
		buf_fmt(&b, "{\"state\":%d,\"ps5\":%s,\"addr\":", (int)hosts[i].state,
				chiaki_discovery_host_is_ps5(&hosts[i]) ? "true" : "false");
		buf_str(&b, hosts[i].host_addr);
		buf_raw(&b, ",\"name\":");
		buf_str(&b, hosts[i].host_name);
		buf_raw(&b, ",\"id\":");
		buf_str(&b, hosts[i].host_id);
		buf_raw(&b, "}");
	}
	buf_raw(&b, "]}");
	emit(&b);
}

static void discovery_stop(void)
{
	if(!g_discovery.active)
		return;
	chiaki_discovery_service_fini(&g_discovery.service);
	g_discovery.active = false;
}

static void discovery_start(const char *send_host, int ping_ms)
{
	discovery_stop();
	chiaki_log_init(&g_discovery.log, CHIAKI_LOG_ERROR | CHIAKI_LOG_WARNING, log_cb, NULL);

	// Servis adresi saklar; ömrü servis kadar olmalı.
	static struct sockaddr_in addr;
	memset(&addr, 0, sizeof(addr));
	addr.sin_family = AF_INET; // port her ping'de servis tarafından (PS4/PS5) ayarlanır
	if(!send_host || inet_pton(AF_INET, send_host, &addr.sin_addr) != 1)
	{
		emit_error("discover", "invalid address");
		return;
	}

	ChiakiDiscoveryServiceOptions options;
	memset(&options, 0, sizeof(options));
	options.hosts_max = 8;
	options.host_drop_pings = 3;
	options.ping_ms = (uint64_t)(ping_ms > 0 ? ping_ms : 1000);
	options.ping_initial_ms = 0;
	options.send_addr = (struct sockaddr_storage *)&addr;
	options.send_addr_size = sizeof(addr);
	options.cb = discovery_cb;
	options.cb_user = NULL;

	ChiakiErrorCode err = chiaki_discovery_service_init(&g_discovery.service, &options, &g_discovery.log);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		emit_error("discover", chiaki_error_string(err));
		return;
	}
	g_discovery.active = true;
}

// ======================================================================== wakeup

/** Kimlik bilgisi: regist anahtarının başındaki onaltılık metin, 64 bit sayıya çevrilir. */
static void wakeup(const char *host, bool ps5, const char *regist_key_b64)
{
	char key_str[CHIAKI_SESSION_AUTH_SIZE + 1];
	memset(key_str, 0, sizeof(key_str));
	ChiakiErrorCode err = CHIAKI_ERR_INVALID_DATA;
	if(host && b64_exact(regist_key_b64, key_str, CHIAKI_SESSION_AUTH_SIZE))
	{
		uint64_t credential = (uint64_t)strtoull(key_str, NULL, 16);
		ChiakiLog log;
		chiaki_log_init(&log, LOG_LEVELS, log_cb, NULL);
		err = chiaki_discovery_wakeup(&log, NULL, host, credential, ps5);
	}
	Buf b = { 0 };
	buf_fmt(&b, "{\"ev\":\"wakeup\",\"ok\":%s,\"error\":", err == CHIAKI_ERR_SUCCESS ? "true" : "false");
	if(err == CHIAKI_ERR_SUCCESS)
		buf_raw(&b, "null");
	else
		buf_str(&b, chiaki_error_string(err));
	buf_raw(&b, "}");
	emit(&b);
}

// ======================================================================== regist (eşleşme)

typedef struct
{
	bool active;
	ChiakiRegist regist;
	ChiakiLog log;
} Regist;

static Regist g_regist;

static void regist_cb(ChiakiRegistEvent *event, void *user)
{
	(void)user;
	Buf b = { 0 };
	if(event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS && event->registered_host)
	{
		ChiakiRegisteredHost *h = event->registered_host;
		buf_raw(&b, "{\"ev\":\"regist\",\"ok\":true,\"nickname\":");
		buf_str(&b, h->server_nickname);
		buf_raw(&b, ",\"registKey\":");
		buf_b64(&b, h->rp_regist_key, sizeof(h->rp_regist_key));
		buf_raw(&b, ",\"rpKey\":");
		buf_b64(&b, h->rp_key, sizeof(h->rp_key));
		buf_raw(&b, ",\"serverMac\":");
		buf_b64(&b, h->server_mac, sizeof(h->server_mac));
		buf_raw(&b, "}");
	}
	else
	{
		buf_raw(&b, "{\"ev\":\"regist\",\"ok\":false,\"error\":");
		buf_str(&b, event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_CANCELED ? "canceled" : "failed");
		buf_raw(&b, "}");
	}
	emit(&b);
}

static void regist_stop(void)
{
	if(!g_regist.active)
		return;
	chiaki_regist_stop(&g_regist.regist);
	chiaki_regist_fini(&g_regist.regist);
	g_regist.active = false;
}

static void regist_start(const char *host, bool ps5, bool broadcast, const char *account_b64, const char *pin)
{
	regist_stop();
	chiaki_log_init(&g_regist.log, LOG_LEVELS, log_cb, NULL);

	ChiakiRegistInfo info;
	memset(&info, 0, sizeof(info));
	if(!host || !pin || !b64_exact(account_b64, info.psn_account_id, sizeof(info.psn_account_id)))
	{
		emit_error("regist", "invalid arguments");
		return;
	}
	info.target = ps5 ? CHIAKI_TARGET_PS5_1 : CHIAKI_TARGET_PS4_10;
	info.host = host; // chiaki kopyalar
	info.broadcast = broadcast;
	info.psn_online_id = NULL;
	info.pin = (uint32_t)strtoul(pin, NULL, 10);
	info.holepunch_info = NULL;

	ChiakiErrorCode err = chiaki_regist_start(&g_regist.regist, &g_regist.log, &info, regist_cb, NULL);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		emit_error("regist", chiaki_error_string(err));
		return;
	}
	g_regist.active = true;
}

// ======================================================================== session (yayın)

typedef struct
{
	bool active;
	ChiakiSession session;
	ChiakiLog log;
	// PS5'in oturum isteğini reddetme nedeni (ör. 0x80108b12 = Remote Play etkin değil).
	// chiaki bunu sadece loga yazar; session_log_cb yakalar.
	volatile uint32_t app_reason;
	// Yayın kanalı (Takion) kuruldu mu. Kurulmadan IDR isteği gönderilirse chiaki boş şifreleme
	// bağlamıyla paket yazmaya çalışıp süreci çökertir (PS5 de oturumu "kullanımda" sanar).
	volatile bool connected;
} Session;

static Session g_session;

#define APP_REASON_PREFIX "Reported Application Reason: "

static void session_log_cb(ChiakiLogLevel level, const char *msg, void *user)
{
	Session *s = user;
	if(s && msg && strncmp(msg, APP_REASON_PREFIX, strlen(APP_REASON_PREFIX)) == 0)
		s->app_reason = (uint32_t)strtoul(msg + strlen(APP_REASON_PREFIX), NULL, 0);
	log_cb(level, msg, NULL);
}

static void event_cb(ChiakiEvent *event, void *user)
{
	Session *s = user;
	Buf b = { 0 };
	switch(event->type)
	{
		case CHIAKI_EVENT_CONNECTED:
			s->connected = true;
			buf_raw(&b, "{\"ev\":\"connected\"}");
			break;
		case CHIAKI_EVENT_QUIT:
		{
			s->connected = false;
			const char *reason = event->quit.reason_str ? event->quit.reason_str
					: chiaki_quit_reason_string(event->quit.reason);
			buf_fmt(&b, "{\"ev\":\"quit\",\"reason\":%d,\"appReason\":%u,\"text\":",
					(int)event->quit.reason, (unsigned)s->app_reason);
			buf_str(&b, reason ? reason : "");
			buf_raw(&b, "}");
			break;
		}
		case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
			buf_raw(&b, "{\"ev\":\"log\",\"level\":\"W\",\"msg\":\"Login PIN requested (PS5 settings: disable 'Require PIN')\"}");
			break;
		default:
			return;
	}
	emit(&b);
}

static bool video_cb(uint8_t *buf, size_t buf_size, int32_t frames_lost, bool frame_recovered, void *user)
{
	(void)frame_recovered;
	(void)user;
	uint8_t lost[4] = { (uint8_t)(frames_lost & 0xff), (uint8_t)((frames_lost >> 8) & 0xff),
		(uint8_t)((frames_lost >> 16) & 0xff), (uint8_t)((frames_lost >> 24) & 0xff) };
	write_packet('V', lost, sizeof(lost), buf, (uint32_t)buf_size);
	return true;
}

/** Oturumu durdurur ve bekler. chiaki thread'inden değil, ana thread'den çağrılmalı. */
static void session_stop(void)
{
	if(!g_session.active)
		return;
	g_session.connected = false;
	chiaki_session_stop(&g_session.session);
	chiaki_session_join(&g_session.session);
	chiaki_session_fini(&g_session.session);
	g_session.active = false;
	Buf b = { 0 };
	buf_raw(&b, "{\"ev\":\"stopped\"}");
	emit(&b);
}

static void session_start(char **argv, int argc)
{
	session_stop();
	if(argc < 9)
	{
		emit_error("session", "invalid arguments");
		return;
	}
	memset(&g_session, 0, sizeof(g_session));
	chiaki_log_init(&g_session.log, LOG_LEVELS, session_log_cb, &g_session);

	bool ps5 = atoi(argv[2]) != 0;
	ChiakiConnectInfo info;
	memset(&info, 0, sizeof(info));
	info.ps5 = ps5;
	info.host = argv[1];
	bool keys_ok = b64_exact(argv[3], info.regist_key, sizeof(info.regist_key))
			&& b64_exact(argv[4], info.morning, sizeof(info.morning))
			&& b64_exact(argv[5], info.psn_account_id, sizeof(info.psn_account_id));
	chiaki_connect_video_profile_preset(&info.video_profile,
			(ChiakiVideoResolutionPreset)atoi(argv[6]), (ChiakiVideoFPSPreset)atoi(argv[7]));
	info.video_profile.codec = ps5 && atoi(argv[8]) == 1 ? CHIAKI_CODEC_H265 : CHIAKI_CODEC_H264;
	info.video_profile_auto_downgrade = true;
	// Ses TV'den HDMI ile geliyor: konsoldan hiç istenmez.
	info.audio_video_disabled = CHIAKI_AUDIO_DISABLED;
	info.holepunch_session = NULL;

	if(!keys_ok)
	{
		emit_error("session", "invalid keys");
		return;
	}
	ChiakiErrorCode err = chiaki_session_init(&g_session.session, &info, &g_session.log);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		emit_error("session", chiaki_error_string(err));
		return;
	}
	chiaki_session_set_event_cb(&g_session.session, event_cb, &g_session);
	chiaki_session_set_video_sample_cb(&g_session.session, video_cb, &g_session);
	err = chiaki_session_start(&g_session.session);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		chiaki_session_fini(&g_session.session);
		emit_error("session", chiaki_error_string(err));
		return;
	}
	g_session.active = true;
	Buf b = { 0 };
	buf_raw(&b, "{\"ev\":\"session\",\"ok\":true}");
	emit(&b);
}

// ======================================================================== çökme izi (hata ayıklama)

#if defined(_WIN32) && defined(ALTYAZI_CRASH_TRACE)
#include <dbghelp.h>
// Erişim hatası gibi istisnalarda çağrı yığınını sembolleriyle stderr'e yazar (.pdb exe'nin yanında olmalı).
static LONG WINAPI crash_handler(EXCEPTION_POINTERS *ep)
{
	DWORD code = ep->ExceptionRecord->ExceptionCode;
	if(code != EXCEPTION_ACCESS_VIOLATION && code != EXCEPTION_STACK_OVERFLOW && code != EXCEPTION_ILLEGAL_INSTRUCTION)
		return EXCEPTION_CONTINUE_SEARCH;
	HANDLE proc = GetCurrentProcess();
	SymSetOptions(SYMOPT_LOAD_LINES | SYMOPT_UNDNAME);
	SymInitialize(proc, NULL, TRUE);
	fprintf(stderr, "CRASH 0x%08lx at %p\n", code, ep->ExceptionRecord->ExceptionAddress);
	CONTEXT ctx = *ep->ContextRecord;
	STACKFRAME64 frame = { 0 };
	frame.AddrPC.Offset = ctx.Rip; frame.AddrPC.Mode = AddrModeFlat;
	frame.AddrFrame.Offset = ctx.Rbp; frame.AddrFrame.Mode = AddrModeFlat;
	frame.AddrStack.Offset = ctx.Rsp; frame.AddrStack.Mode = AddrModeFlat;
	for(int i = 0; i < 32 && StackWalk64(IMAGE_FILE_MACHINE_AMD64, proc, GetCurrentThread(), &frame, &ctx,
			NULL, SymFunctionTableAccess64, SymGetModuleBase64, NULL); i++)
	{
		char buf[sizeof(SYMBOL_INFO) + 256];
		SYMBOL_INFO *sym = (SYMBOL_INFO *)buf;
		sym->SizeOfStruct = sizeof(SYMBOL_INFO);
		sym->MaxNameLen = 255;
		DWORD64 disp = 0;
		IMAGEHLP_LINE64 line = { .SizeOfStruct = sizeof(line) };
		DWORD ldisp = 0;
		const char *name = SymFromAddr(proc, frame.AddrPC.Offset, &disp, sym) ? sym->Name : "?";
		if(SymGetLineFromAddr64(proc, frame.AddrPC.Offset, &ldisp, &line))
			fprintf(stderr, "  #%d %s (%s:%lu)\n", i, name, line.FileName, line.LineNumber);
		else
			fprintf(stderr, "  #%d %s +0x%llx rva=0x%llx\n", i, name, (unsigned long long)disp,
					(unsigned long long)(frame.AddrPC.Offset - (DWORD64)(uintptr_t)GetModuleHandle(NULL)));
	}
	fflush(stderr);
	return EXCEPTION_CONTINUE_SEARCH;
}
#endif

// ======================================================================== ana döngü

#define MAX_ARGS 12

int main(void)
{
#ifdef _WIN32
	_setmode(_fileno(stdout), _O_BINARY);
#ifdef ALTYAZI_CRASH_TRACE
	AddVectoredExceptionHandler(1, crash_handler);
#endif
#endif
	chiaki_mutex_init(&g_out_mutex, false);
	ChiakiErrorCode err = chiaki_lib_init();
	{
		Buf b = { 0 };
		buf_fmt(&b, "{\"ev\":\"ready\",\"ok\":%s,\"version\":\"%s\",\"error\":",
				err == CHIAKI_ERR_SUCCESS ? "true" : "false", CHIAKI_VERSION);
		if(err == CHIAKI_ERR_SUCCESS)
			buf_raw(&b, "null");
		else
			buf_str(&b, chiaki_error_string(err));
		buf_raw(&b, "}");
		emit(&b);
	}
	if(err != CHIAKI_ERR_SUCCESS)
		return 1;

	static char line[4096];
	while(fgets(line, sizeof(line), stdin))
	{
		char *argv[MAX_ARGS];
		int argc = 0;
		for(char *tok = strtok(line, " \t\r\n"); tok && argc < MAX_ARGS; tok = strtok(NULL, " \t\r\n"))
			argv[argc++] = tok;
		if(argc == 0)
			continue;
		const char *cmd = argv[0];

		if(!strcmp(cmd, "discover"))
			discovery_start(argc > 1 ? argv[1] : "255.255.255.255", argc > 2 ? atoi(argv[2]) : 1000);
		else if(!strcmp(cmd, "discover_stop"))
			discovery_stop();
		else if(!strcmp(cmd, "wakeup") && argc >= 4)
			wakeup(argv[1], atoi(argv[2]) != 0, argv[3]);
		else if(!strcmp(cmd, "regist") && argc >= 6)
			regist_start(argv[1], atoi(argv[2]) != 0, atoi(argv[3]) != 0, argv[4], argv[5]);
		else if(!strcmp(cmd, "regist_stop"))
			regist_stop();
		else if(!strcmp(cmd, "session"))
			session_start(argv, argc);
		else if(!strcmp(cmd, "session_stop"))
			session_stop();
		else if(!strcmp(cmd, "idr"))
		{
			if(g_session.active && g_session.connected)
				chiaki_session_request_idr(&g_session.session);
		}
		else if(!strcmp(cmd, "quit"))
			break;
		else
			emit_error("command", cmd);
	}

	session_stop();
	regist_stop();
	discovery_stop();
	return 0;
}

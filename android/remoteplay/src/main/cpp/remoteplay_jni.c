// SPDX-License-Identifier: AGPL-3.0-only
//
// chiaki-ng çekirdeği için ince JNI köprüsü (Kotlin: com.altyazioverlay.remoteplay.ChiakiNative).
// Sadece ihtiyacımız olan kısım: PS5 ile eşleşme (regist) ve yayın oturumu (session).
// Ses, kontrolcü girişi ve ekrana çizim yok: video örnekleri (H.264/H.265 kareleri) Kotlin'e
// verilir, orada MediaCodec ile ImageReader'a çözülür.

#include <jni.h>
#include <android/log.h>
#include <pthread.h>
#include <stdlib.h>
#include <string.h>

#include <chiaki/common.h>
#include <chiaki/log.h>
#include <chiaki/regist.h>
#include <chiaki/session.h>

#define TAG "chiaki"
#define JNI_FCN(name) Java_com_altyazioverlay_remoteplay_ChiakiNative_##name

static JavaVM *g_vm = NULL;
static pthread_key_t g_env_key;

// Chiaki'nin kendi thread'lerinden Java'ya çağrı için: thread başına bir kez attach,
// thread bitince otomatik detach (aksi halde ART thread çıkışında çöker).
static void detach_thread(void *unused)
{
	(void)unused;
	(*g_vm)->DetachCurrentThread(g_vm);
}

static JNIEnv *get_env(void)
{
	JNIEnv *env = NULL;
	if((*g_vm)->GetEnv(g_vm, (void **)&env, JNI_VERSION_1_6) == JNI_OK)
		return env;
	if((*g_vm)->AttachCurrentThread(g_vm, &env, NULL) != JNI_OK)
		return NULL;
	pthread_setspecific(g_env_key, env);
	return env;
}

JNIEXPORT jint JNI_OnLoad(JavaVM *vm, void *reserved)
{
	(void)reserved;
	g_vm = vm;
	pthread_key_create(&g_env_key, detach_thread);
	return JNI_VERSION_1_6;
}

static void log_cb(ChiakiLogLevel level, const char *msg, void *user)
{
	(void)user;
	int prio = ANDROID_LOG_DEBUG;
	switch(level)
	{
		case CHIAKI_LOG_ERROR: prio = ANDROID_LOG_ERROR; break;
		case CHIAKI_LOG_WARNING: prio = ANDROID_LOG_WARN; break;
		case CHIAKI_LOG_INFO: prio = ANDROID_LOG_INFO; break;
		default: prio = ANDROID_LOG_DEBUG; break;
	}
	__android_log_write(prio, TAG, msg);
}

static jbyteArray new_byte_array(JNIEnv *env, const void *data, size_t size)
{
	jbyteArray arr = (*env)->NewByteArray(env, (jsize)size);
	if(arr)
		(*env)->SetByteArrayRegion(env, arr, 0, (jsize)size, (const jbyte *)data);
	return arr;
}

static bool copy_byte_array(JNIEnv *env, jbyteArray arr, void *dst, size_t size)
{
	if(!arr || (size_t)(*env)->GetArrayLength(env, arr) != size)
		return false;
	(*env)->GetByteArrayRegion(env, arr, 0, (jsize)size, (jbyte *)dst);
	return true;
}

JNIEXPORT jstring JNICALL JNI_FCN(errorString)(JNIEnv *env, jobject obj, jint code)
{
	(void)obj;
	return (*env)->NewStringUTF(env, chiaki_error_string((ChiakiErrorCode)code));
}

// ======================================================================== regist (eşleşme)

typedef struct
{
	ChiakiRegist regist;
	ChiakiLog log;
	jobject callback;            // RegistCallback (global ref)
	jmethodID on_finished;
} Regist;

static void regist_cb(ChiakiRegistEvent *event, void *user)
{
	Regist *r = user;
	JNIEnv *env = get_env();
	if(!env)
		return;

	jboolean success = event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_SUCCESS;
	jstring nickname = NULL;
	jbyteArray regist_key = NULL, rp_key = NULL, server_mac = NULL;
	jstring message = NULL;

	if(success && event->registered_host)
	{
		ChiakiRegisteredHost *h = event->registered_host;
		nickname = (*env)->NewStringUTF(env, h->server_nickname);
		regist_key = new_byte_array(env, h->rp_regist_key, sizeof(h->rp_regist_key));
		rp_key = new_byte_array(env, h->rp_key, sizeof(h->rp_key));
		server_mac = new_byte_array(env, h->server_mac, sizeof(h->server_mac));
	}
	else
	{
		message = (*env)->NewStringUTF(env,
				event->type == CHIAKI_REGIST_EVENT_TYPE_FINISHED_CANCELED ? "canceled" : "failed");
	}

	(*env)->CallVoidMethod(env, r->callback, r->on_finished, success, nickname, regist_key, rp_key, server_mac, message);
	if((*env)->ExceptionCheck(env))
		(*env)->ExceptionClear(env);
}

JNIEXPORT jlong JNICALL JNI_FCN(registStart)(JNIEnv *env, jobject obj, jstring host, jboolean ps5,
		jboolean broadcast, jbyteArray psn_account_id, jint pin, jobject callback)
{
	(void)obj;
	Regist *r = calloc(1, sizeof(Regist));
	if(!r)
		return 0;
	chiaki_log_init(&r->log, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, log_cb, NULL);
	r->callback = (*env)->NewGlobalRef(env, callback);
	r->on_finished = (*env)->GetMethodID(env, (*env)->GetObjectClass(env, callback), "onRegistFinished",
			"(ZLjava/lang/String;[B[B[BLjava/lang/String;)V");

	ChiakiRegistInfo info;
	memset(&info, 0, sizeof(info));
	info.target = ps5 ? CHIAKI_TARGET_PS5_1 : CHIAKI_TARGET_PS4_10;
	info.host = (*env)->GetStringUTFChars(env, host, NULL);
	info.broadcast = broadcast;
	info.psn_online_id = NULL;
	copy_byte_array(env, psn_account_id, info.psn_account_id, sizeof(info.psn_account_id));
	info.pin = (uint32_t)pin;
	info.holepunch_info = NULL;

	ChiakiErrorCode err = chiaki_regist_start(&r->regist, &r->log, &info, regist_cb, r);
	(*env)->ReleaseStringUTFChars(env, host, info.host);

	if(err != CHIAKI_ERR_SUCCESS)
	{
		__android_log_print(ANDROID_LOG_ERROR, TAG, "regist start failed: %s", chiaki_error_string(err));
		(*env)->DeleteGlobalRef(env, r->callback);
		free(r);
		return 0;
	}
	return (jlong)(intptr_t)r;
}

JNIEXPORT void JNICALL JNI_FCN(registStop)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)env; (void)obj;
	Regist *r = (Regist *)(intptr_t)ptr;
	if(r)
		chiaki_regist_stop(&r->regist);
}

JNIEXPORT void JNICALL JNI_FCN(registFree)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)obj;
	Regist *r = (Regist *)(intptr_t)ptr;
	if(!r)
		return;
	chiaki_regist_fini(&r->regist);
	(*env)->DeleteGlobalRef(env, r->callback);
	free(r);
}

// ======================================================================== session (yayın)

typedef struct
{
	ChiakiSession session;
	ChiakiLog log;
	jobject callback;            // SessionCallback (global ref)
	jmethodID on_connected;
	jmethodID on_quit;
	jmethodID on_video;
} Session;

static void event_cb(ChiakiEvent *event, void *user)
{
	Session *s = user;
	JNIEnv *env = get_env();
	if(!env)
		return;
	switch(event->type)
	{
		case CHIAKI_EVENT_CONNECTED:
			(*env)->CallVoidMethod(env, s->callback, s->on_connected);
			break;
		case CHIAKI_EVENT_QUIT:
		{
			const char *reason = event->quit.reason_str ? event->quit.reason_str
					: chiaki_quit_reason_string(event->quit.reason);
			jstring str = (*env)->NewStringUTF(env, reason ? reason : "");
			(*env)->CallVoidMethod(env, s->callback, s->on_quit, (jint)event->quit.reason, str);
			break;
		}
		case CHIAKI_EVENT_LOGIN_PIN_REQUEST:
			__android_log_write(ANDROID_LOG_WARN, TAG, "Login PIN requested (PS5 settings: disable 'Require PIN')");
			break;
		default:
			break;
	}
	if((*env)->ExceptionCheck(env))
		(*env)->ExceptionClear(env);
}

static bool video_cb(uint8_t *buf, size_t buf_size, int32_t frames_lost, bool frame_recovered, void *user)
{
	(void)frame_recovered;
	Session *s = user;
	JNIEnv *env = get_env();
	if(!env)
		return false;
	jbyteArray arr = new_byte_array(env, buf, buf_size);
	if(!arr)
		return false;
	jboolean ok = (*env)->CallBooleanMethod(env, s->callback, s->on_video, arr, (jint)frames_lost);
	(*env)->DeleteLocalRef(env, arr);
	if((*env)->ExceptionCheck(env))
	{
		(*env)->ExceptionClear(env);
		return false;
	}
	return ok;
}

/**
 * @param resolution 1=360p 2=540p 3=720p 4=1080p   @param fps 30|60   @param codec 0=H264 1=H265
 * @return yerel oturum işaretçisi, hata durumunda 0
 */
JNIEXPORT jlong JNICALL JNI_FCN(sessionCreate)(JNIEnv *env, jobject obj, jstring host, jboolean ps5,
		jbyteArray regist_key, jbyteArray morning, jbyteArray psn_account_id,
		jint resolution, jint fps, jint codec, jobject callback)
{
	(void)obj;
	Session *s = calloc(1, sizeof(Session));
	if(!s)
		return 0;
	chiaki_log_init(&s->log, CHIAKI_LOG_ALL & ~CHIAKI_LOG_VERBOSE, log_cb, NULL);

	ChiakiConnectInfo info;
	memset(&info, 0, sizeof(info));
	info.ps5 = ps5;
	info.host = (*env)->GetStringUTFChars(env, host, NULL);
	bool keys_ok = copy_byte_array(env, regist_key, info.regist_key, sizeof(info.regist_key))
			&& copy_byte_array(env, morning, info.morning, sizeof(info.morning));
	copy_byte_array(env, psn_account_id, info.psn_account_id, sizeof(info.psn_account_id));
	chiaki_connect_video_profile_preset(&info.video_profile,
			(ChiakiVideoResolutionPreset)resolution, (ChiakiVideoFPSPreset)fps);
	info.video_profile.codec = ps5 ? (ChiakiCodec)codec : CHIAKI_CODEC_H264;
	info.video_profile_auto_downgrade = true;
	// Ses TV'den HDMI ile geliyor: konsoldan hiç istenmez.
	info.audio_video_disabled = CHIAKI_AUDIO_DISABLED;
	info.holepunch_session = NULL;

	ChiakiErrorCode err = keys_ok ? chiaki_session_init(&s->session, &info, &s->log) : CHIAKI_ERR_INVALID_DATA;
	(*env)->ReleaseStringUTFChars(env, host, info.host);
	if(err != CHIAKI_ERR_SUCCESS)
	{
		__android_log_print(ANDROID_LOG_ERROR, TAG, "session init failed: %s", chiaki_error_string(err));
		free(s);
		return 0;
	}

	s->callback = (*env)->NewGlobalRef(env, callback);
	jclass cls = (*env)->GetObjectClass(env, callback);
	s->on_connected = (*env)->GetMethodID(env, cls, "onConnected", "()V");
	s->on_quit = (*env)->GetMethodID(env, cls, "onQuit", "(ILjava/lang/String;)V");
	s->on_video = (*env)->GetMethodID(env, cls, "onVideoSample", "([BI)Z");

	chiaki_session_set_event_cb(&s->session, event_cb, s);
	chiaki_session_set_video_sample_cb(&s->session, video_cb, s);
	return (jlong)(intptr_t)s;
}

JNIEXPORT jint JNICALL JNI_FCN(sessionStart)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)env; (void)obj;
	return chiaki_session_start(&((Session *)(intptr_t)ptr)->session);
}

JNIEXPORT jint JNICALL JNI_FCN(sessionStop)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)env; (void)obj;
	return chiaki_session_stop(&((Session *)(intptr_t)ptr)->session);
}

JNIEXPORT jint JNICALL JNI_FCN(sessionJoin)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)env; (void)obj;
	return chiaki_session_join(&((Session *)(intptr_t)ptr)->session);
}

/** IDR (tam kare) iste: çözücü yeni başladığında / kare kaybında görüntüyü hızla toparlar. */
JNIEXPORT void JNICALL JNI_FCN(sessionRequestIdr)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)env; (void)obj;
	chiaki_session_request_idr(&((Session *)(intptr_t)ptr)->session);
}

JNIEXPORT void JNICALL JNI_FCN(sessionFree)(JNIEnv *env, jobject obj, jlong ptr)
{
	(void)obj;
	Session *s = (Session *)(intptr_t)ptr;
	if(!s)
		return;
	chiaki_session_fini(&s->session);
	(*env)->DeleteGlobalRef(env, s->callback);
	free(s);
}

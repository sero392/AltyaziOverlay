// SPDX-License-Identifier: AGPL-3.0-only
//
// chiaki-ng'nin holepunch.c dosyası yerine geçer. Holepunch yalnızca internet üzerinden
// (PSN sunucuları aracılığıyla) Remote Play içindir ve curl + json-c + miniupnpc gerektirir.
// Bu uygulama sadece yerel ağda bağlandığı için holepunch oturumu hiçbir zaman oluşturulmaz
// (connect_info.holepunch_session = NULL); çekirdeğin referans verdiği semboller burada
// "desteklenmiyor" döndürür.

#include <netinet/in.h>  // INET6_ADDRSTRLEN (holepunch.h bunu dahil etmiyor)
#include <chiaki/remote/holepunch.h>
#include <string.h>

ChiakiErrorCode chiaki_holepunch_session_punch_hole(ChiakiHolepunchSession session, ChiakiHolepunchPortType port_type)
{
	(void)session;
	(void)port_type;
	return CHIAKI_ERR_INVALID_DATA;
}

void chiaki_holepunch_session_fini(ChiakiHolepunchSession session)
{
	(void)session;
}

void chiaki_holepunch_main_thread_cancel(ChiakiHolepunchSession session, bool stop_thread)
{
	(void)session;
	(void)stop_thread;
}

ChiakiHolepunchRegistInfo chiaki_get_regist_info(ChiakiHolepunchSession session)
{
	(void)session;
	ChiakiHolepunchRegistInfo info;
	memset(&info, 0, sizeof(info));
	return info;
}

void chiaki_get_ps_selected_addr(ChiakiHolepunchSession session, char *ps_ip)
{
	(void)session;
	if(ps_ip)
		ps_ip[0] = '\0';
}

uint16_t chiaki_get_ps_ctrl_port(ChiakiHolepunchSession session)
{
	(void)session;
	return 0;
}

chiaki_socket_t *chiaki_get_holepunch_sock(ChiakiHolepunchSession session, ChiakiHolepunchPortType type)
{
	(void)session;
	(void)type;
	return NULL;
}

ChiakiErrorCode holepunch_session_create_offer(ChiakiHolepunchSession session)
{
	(void)session;
	return CHIAKI_ERR_INVALID_DATA;
}

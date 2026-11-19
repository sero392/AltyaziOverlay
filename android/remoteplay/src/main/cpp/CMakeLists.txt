cmake_minimum_required(VERSION 3.22)
project(altyazi_remoteplay C)

# chiaki-ng çekirdeğini (lib/) kendi hedeflerimizle derler. chiaki-ng'nin kendi CMake'i
# kullanılmıyor çünkü:
#  - protobuf üretimi derleme anında protoc + Python ister (generated/ altında hazır üretildi,
#    yeniden üretmek için: scripts/gen-chiaki-proto.sh),
#  - json-c / miniupnpc entegrasyonu Windows'ta izin gerektiren sembolik link oluşturur,
#  - curl / json-c / miniupnpc yalnızca internet üzerinden Remote Play (holepunch) içindir;
#    biz sadece yerel ağ kullanıyoruz -> holepunch_stub.c.
# chiaki-ng kaynaklarına dokunulmaz (submodule temiz kalır).

set(CHIAKI_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../../../third_party/chiaki-ng")
get_filename_component(CHIAKI_DIR "${CHIAKI_DIR}" ABSOLUTE)
set(CHIAKI_LIB "${CHIAKI_DIR}/lib")
set(CHIAKI_THIRD "${CHIAKI_DIR}/third-party")

include(FetchContent)

# ---------------------------------------------------------------- Mbed TLS (OpenSSL yerine)
# chiaki-ng CHIAKI_LIB_ENABLE_MBEDTLS ile Mbed TLS 2.28'i destekler. OpenSSL'in Android
# derlemesi perl + make ister; Mbed TLS saf CMake olduğu için her platformda derlenir.
set(ENABLE_TESTING OFF CACHE BOOL "" FORCE)
set(ENABLE_PROGRAMS OFF CACHE BOOL "" FORCE)
set(USE_SHARED_MBEDTLS_LIBRARY OFF CACHE BOOL "" FORCE)
set(USE_STATIC_MBEDTLS_LIBRARY ON CACHE BOOL "" FORCE)
set(MBEDTLS_FATAL_WARNINGS OFF CACHE BOOL "" FORCE)
FetchContent_Declare(mbedtls
    URL https://github.com/Mbed-TLS/mbedtls/archive/refs/tags/v2.28.8.tar.gz
)
FetchContent_MakeAvailable(mbedtls)

# ---------------------------------------------------------------- nanopb (çalışma zamanı)
add_library(chiaki_nanopb STATIC
    "${CHIAKI_THIRD}/nanopb/pb_common.c"
    "${CHIAKI_THIRD}/nanopb/pb_encode.c"
    "${CHIAKI_THIRD}/nanopb/pb_decode.c")
target_include_directories(chiaki_nanopb PUBLIC "${CHIAKI_THIRD}/nanopb")
target_compile_definitions(chiaki_nanopb PUBLIC PB_C99_STATIC_ASSERT)

# ---------------------------------------------------------------- gf-complete + jerasure (FEC)
add_library(chiaki_gf_complete STATIC
    "${CHIAKI_THIRD}/gf-complete/src/gf.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_wgen.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w4.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w8.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w16.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w32.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w64.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_w128.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_rand.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_general.c"
    "${CHIAKI_THIRD}/gf-complete/src/gf_cpu.c")
target_include_directories(chiaki_gf_complete PUBLIC "${CHIAKI_THIRD}/gf-complete/include")

add_library(chiaki_jerasure STATIC
    "${CHIAKI_THIRD}/jerasure/src/galois.c"
    "${CHIAKI_THIRD}/jerasure/src/jerasure.c"
    "${CHIAKI_THIRD}/jerasure/src/reed_sol.c"
    "${CHIAKI_THIRD}/jerasure/src/cauchy.c"
    "${CHIAKI_THIRD}/jerasure/src/liberation.c")
target_include_directories(chiaki_jerasure PUBLIC "${CHIAKI_THIRD}/jerasure/include")
target_link_libraries(chiaki_jerasure PUBLIC chiaki_gf_complete)

# ---------------------------------------------------------------- chiaki çekirdeği
# opusdecoder.c / opusencoder.c derlenmez: ses konsoldan hiç istenmiyor (TV HDMI ile çalıyor).
set(CHIAKI_LIB_ENABLE_OPUS 0)
set(CHIAKI_LIB_ENABLE_PI_DECODER 0)
set(CHIAKI_LIB_ENABLE_FFMPEG_DECODER 0)
configure_file("${CHIAKI_LIB}/config.h.in" "${CMAKE_CURRENT_BINARY_DIR}/include/chiaki/config.h")

set(CHIAKI_SOURCES
    common.c sock.c session.c thread.c base64.c http.c log.c ctrl.c rpcrypt.c takion.c
    senkusha.c streamconnection.c ecdh.c launchspec.c random.c gkcrypt.c audio.c
    audioreceiver.c audiosender.c videoreceiver.c frameprocessor.c packetstats.c discovery.c
    congestioncontrol.c stoppipe.c reorderqueue.c discoveryservice.c feedback.c
    feedbacksender.c controller.c takionsendbuffer.c time.c fec.c regist.c
    orientation.c bitstream.c remote/rudp.c remote/rudpsendbuffer.c)
list(TRANSFORM CHIAKI_SOURCES PREPEND "${CHIAKI_LIB}/src/")

# İzleyici modu: chiaki yayın başlarken PS5'e "sanal kontrolcü bağlandı" ve "mikrofon aç"
# mesajları gönderir. PS5 bunun üzerine kullanıcının aktif kolunu Remote Play'e devreder ve
# konsola bağlı fiziksel DualSense'in bağlantısını keser. Bu uygulama hiç giriş göndermediği
# için iki mesaj da atlanır: streamconnection.c derleme dizininde yamalı kopyadan derlenir
# (submodule'e dokunulmaz). chiaki-ng güncellenip satırlar değişirse derleme durur.
file(READ "${CHIAKI_LIB}/src/streamconnection.c" STREAMCONNECTION_SRC)
# C kodu ';' içerdiği için yamalar CMake listesi değil, tek tek çağrılır (tırnaklı argümanlar bölünmez).
function(patch_streamconnection FROM TO)
    string(FIND "${STREAMCONNECTION_SRC}" "${FROM}" POS)
    if(POS EQUAL -1)
        message(FATAL_ERROR "streamconnection.c yaması uygulanamadı (chiaki-ng değişmiş): ${FROM}")
    endif()
    string(REPLACE "${FROM}" "${TO}" RESULT "${STREAMCONNECTION_SRC}")
    set(STREAMCONNECTION_SRC "${RESULT}" PARENT_SCOPE)
endfunction()
patch_streamconnection(
    "ChiakiErrorCode err = stream_connection_send_controller_connection(stream_connection)"
    "ChiakiErrorCode err = CHIAKI_ERR_SUCCESS /* altyazi: izleyici modu, sanal kol duyurulmaz */")
patch_streamconnection(
    "err = stream_connection_enable_microphone(stream_connection)"
    "err = CHIAKI_ERR_SUCCESS /* altyazi: izleyici modu, mikrofon açılmaz */")
set(PATCHED_STREAMCONNECTION "${CMAKE_CURRENT_BINARY_DIR}/patched/streamconnection.c")
file(WRITE "${PATCHED_STREAMCONNECTION}" "${STREAMCONNECTION_SRC}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CHIAKI_LIB}/src/streamconnection.c")
list(REMOVE_ITEM CHIAKI_SOURCES "${CHIAKI_LIB}/src/streamconnection.c")
list(APPEND CHIAKI_SOURCES "${PATCHED_STREAMCONNECTION}")

# Hata düzeltmesi: chiaki_rpcrypt_generate_iv'in Mbed TLS dalında HMAC-SHA256 çıktısı (32 bayt)
# 16 baytlık yığın tamponuna yazılıyor ve yanındaki mbedtls_md_context_t'yi bozuyor. Android'de
# yığın düzeni şans eseri zarar görmüyordu; Windows'ta (desktop/) eşleştirme bu yüzden çöküyordu.
file(READ "${CHIAKI_LIB}/src/rpcrypt.c" RPCRYPT_SRC)
set(RPCRYPT_FROM "uint8_t hmac[CHIAKI_RPCRYPT_KEY_SIZE];\n\tunsigned int hmac_len = 0;")
string(FIND "${RPCRYPT_SRC}" "${RPCRYPT_FROM}" POS)
if(POS EQUAL -1)
    message(FATAL_ERROR "rpcrypt.c yaması uygulanamadı (chiaki-ng değişmiş)")
endif()
string(REPLACE "${RPCRYPT_FROM}"
    "uint8_t hmac[32]; /* altyazi: SHA256 çıktısı 32 bayt (taşma düzeltmesi) */\n\tunsigned int hmac_len = 0;"
    RPCRYPT_SRC "${RPCRYPT_SRC}")
set(PATCHED_RPCRYPT "${CMAKE_CURRENT_BINARY_DIR}/patched/rpcrypt.c")
file(WRITE "${PATCHED_RPCRYPT}" "${RPCRYPT_SRC}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CHIAKI_LIB}/src/rpcrypt.c")
list(REMOVE_ITEM CHIAKI_SOURCES "${CHIAKI_LIB}/src/rpcrypt.c")
list(APPEND CHIAKI_SOURCES "${PATCHED_RPCRYPT}")

# Hata düzeltmesi: PS5 paket kaybı olduğunda onaylara (data ack) "boşluk bloğu" ekler
# (12 + 4*n bayt). chiaki yalnızca tam 12 baytlık onayı kabul edip gerisini atıyordu; bu yüzden
# kayıplı Wi-Fi'da gönderilen her paket 25 kez yeniden yollanıyor, gönderme tamponu taşıyor ve
# PS5 oturumu kapatıyordu. Kümülatif onay her durumda işlenir; boşluk sayısı ayrıca doğrulanır.
file(READ "${CHIAKI_LIB}/src/takion.c" TAKION_SRC)
set(TAKION_FROM "if(buf_size != 0xc)\n\t{\n\t\tCHIAKI_LOGE(takion->log, \"Takion received data ack with size")
string(FIND "${TAKION_SRC}" "${TAKION_FROM}" POS)
if(POS EQUAL -1)
    message(FATAL_ERROR "takion.c yaması uygulanamadı (chiaki-ng değişmiş)")
endif()
string(REPLACE "${TAKION_FROM}"
    "if(buf_size < 0xc) /* altyazi: boşluk bloklu onaylar da kabul edilir */\n\t{\n\t\tCHIAKI_LOGE(takion->log, \"Takion received data ack with size"
    TAKION_SRC "${TAKION_SRC}")
set(PATCHED_TAKION "${CMAKE_CURRENT_BINARY_DIR}/patched/takion.c")
file(WRITE "${PATCHED_TAKION}" "${TAKION_SRC}")
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CHIAKI_LIB}/src/takion.c")
list(REMOVE_ITEM CHIAKI_SOURCES "${CHIAKI_LIB}/src/takion.c")
list(APPEND CHIAKI_SOURCES "${PATCHED_TAKION}")

add_library(chiaki STATIC
    ${CHIAKI_SOURCES}
    "${CMAKE_CURRENT_SOURCE_DIR}/generated/takion.pb.c"
    "${CMAKE_CURRENT_SOURCE_DIR}/holepunch_stub.c")
target_include_directories(chiaki PRIVATE "${CHIAKI_LIB}/src")  # yamalı kopyanın "utils.h" vb. için
target_include_directories(chiaki PUBLIC
    "${CHIAKI_LIB}/include"
    "${CMAKE_CURRENT_BINARY_DIR}/include"
    "${CMAKE_CURRENT_SOURCE_DIR}/generated")
target_compile_definitions(chiaki PUBLIC
    CHIAKI_LIB_ENABLE_MBEDTLS
    CHIAKI_VERSION_MAJOR=1 CHIAKI_VERSION_MINOR=10 CHIAKI_VERSION_PATCH=0
    CHIAKI_VERSION="1.10.0")
target_compile_options(chiaki PRIVATE -Wno-unused-function -Wno-unused-variable)
target_link_libraries(chiaki PUBLIC chiaki_nanopb chiaki_jerasure mbedtls mbedx509 mbedcrypto log)

# ---------------------------------------------------------------- JNI köprüsü
add_library(altyazi_remoteplay SHARED remoteplay_jni.c)
target_link_libraries(altyazi_remoteplay PRIVATE chiaki log)

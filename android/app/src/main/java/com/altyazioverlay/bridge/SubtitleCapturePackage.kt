package com.altyazioverlay.bridge

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class SubtitleCapturePackage : BaseReactPackage() {

    override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
        when (name) {
            SubtitleCaptureModule.NAME -> SubtitleCaptureModule(reactContext)
            RemotePlayModule.NAME -> RemotePlayModule(reactContext)
            else -> null
        }

    override fun getReactModuleInfoProvider(): ReactModuleInfoProvider = ReactModuleInfoProvider {
        mapOf(
            SubtitleCaptureModule.NAME to ReactModuleInfo(
                SubtitleCaptureModule.NAME,
                SubtitleCaptureModule::class.java.name,
                false, // canOverrideExistingModule
                true,  // needsEagerInit: event bus kaydı uygulama açılır açılmaz yapılsın
                false, // isCxxModule
                false, // isTurboModule (yeni mimaride interop katmanı üzerinden)
            ),
            RemotePlayModule.NAME to ReactModuleInfo(
                RemotePlayModule.NAME,
                RemotePlayModule::class.java.name,
                false,
                false, // needsEagerInit: sadece kullanılınca yüklensin
                false,
                false,
            ),
        )
    }
}

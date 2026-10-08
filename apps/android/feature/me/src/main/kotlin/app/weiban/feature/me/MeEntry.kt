package app.weiban.feature.me

import app.weiban.data.DeviceNotificationControls

data class MeEntry(
    val page: String? = null,
    val notifications: DeviceNotificationControls? = null,
)

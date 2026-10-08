package app.weiban.data

/** UI capabilities supplied by app; feature modules do not depend on the platform module. */
data class DeviceNotificationControls(
    val status: String,
    val available: Boolean,
    val enabled: Boolean,
    val busy: Boolean,
    val enable: () -> Unit,
    val disable: () -> Unit,
    val systemSettings: (() -> Unit)? = null,
)

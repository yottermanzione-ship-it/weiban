package app.weiban.feature.me

import app.weiban.data.DeviceNotificationControls

data class MeEntry(
    val page: String? = null,
    val notifications: DeviceNotificationControls? = null,
    /** 「我 › 朋友圈」（SVC-01）：由宿主打开只看自己的朋友圈。 */
    val onMyMoments: (() -> Unit)? = null,
    /** 「我 › 表情」（T-074）：由宿主打开我添加的表情页。 */
    val onMyStickers: (() -> Unit)? = null,
)

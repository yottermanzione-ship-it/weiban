@file:Suppress("MatchingDeclarationName")

package app.weiban.feature.chat

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri

/**
 * 链接卡片唤起 App（MED-05 第 1 条；支持清单见 docs/android/media-l5.md 第 4 节）。
 * 识别出的平台：带包名的 ACTION_VIEW 交给该 App 处理；没装或不接这个链接时，用系统浏览器打开（不内置浏览器）。
 * startActivity 不受安卓 11 起的「软件包可见性」限制，所以不需要在清单里声明 queries。
 */
internal data class LinkPlatform(
    val name: String,
    val packageName: String,
    val hosts: List<String>,
)

internal val linkPlatforms =
    listOf(
        LinkPlatform("网易云音乐", "com.netease.cloudmusic", listOf("music.163.com", "163cn.tv")),
        LinkPlatform("QQ 音乐", "com.tencent.qqmusic", listOf("y.qq.com")),
        LinkPlatform("酷狗音乐", "com.kugou.android", listOf("kugou.com")),
        LinkPlatform("酷我音乐", "cn.kuwo.player", listOf("kuwo.cn")),
        LinkPlatform("汽水音乐", "com.luna.music", listOf("qishui.douyin.com")),
        LinkPlatform("哔哩哔哩", "tv.danmaku.bili", listOf("bilibili.com", "b23.tv")),
        LinkPlatform("抖音", "com.ss.android.ugc.aweme", listOf("douyin.com", "iesdouyin.com")),
        LinkPlatform("快手", "com.smile.gifmaker", listOf("kuaishou.com", "gifshow.com")),
        LinkPlatform("腾讯视频", "com.tencent.qqlive", listOf("v.qq.com")),
        LinkPlatform("爱奇艺", "com.qiyi.video", listOf("iqiyi.com")),
        LinkPlatform("优酷", "com.youku.phone", listOf("youku.com")),
        LinkPlatform("芒果 TV", "com.hunantv.imgo.activity", listOf("mgtv.com")),
        LinkPlatform("小红书", "com.xingin.xhs", listOf("xiaohongshu.com", "xhslink.com")),
        LinkPlatform("微博", "com.sina.weibo", listOf("weibo.com", "weibo.cn")),
    )

internal fun linkPlatform(url: String): LinkPlatform? {
    val host =
        Uri
            .parse(url)
            .host
            ?.lowercase()
            ?: return null
    // 汽水音乐的域名挂在 douyin.com 下，按清单顺序先匹配更具体的。
    return linkPlatforms
        .sortedByDescending { platform -> platform.hosts.maxOf { it.length } }
        .find { platform -> platform.hosts.any { host == it || host.endsWith(".$it") } }
}

/** 返回 false = 没有任何 App 能打开（极少见），由调用方提示。 */
@Suppress("ReturnCount") // 首次本机构建（2026-10-11）：保留既有逻辑，复杂度待重构
internal fun openLink(
    context: Context,
    url: String,
): Boolean {
    val uri = Uri.parse(url)
    if (uri.scheme != "https" && uri.scheme != "http") return false
    val platform = linkPlatform(url)
    if (platform != null) {
        val app =
            Intent(Intent.ACTION_VIEW, uri)
                .setPackage(platform.packageName)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        try {
            context.startActivity(app)
            return true
        } catch (_: ActivityNotFoundException) {
            // 没装：退回浏览器。
        }
    }
    return try {
        context.startActivity(
            Intent(Intent.ACTION_VIEW, uri)
                .addCategory(Intent.CATEGORY_BROWSABLE)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
        true
    } catch (_: ActivityNotFoundException) {
        false
    }
}

private val urlPattern = Regex("""https?://[^\s<>"'，。！？、）】」]+""")

/** 用户文字里的链接（media-l5.md 4.2）：识别为可点，不转卡片。 */
internal fun linkRanges(text: String): List<IntRange> = urlPattern.findAll(text).map { it.range }.toList()

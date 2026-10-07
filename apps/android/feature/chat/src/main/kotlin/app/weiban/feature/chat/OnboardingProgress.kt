package app.weiban.feature.chat

import androidx.compose.runtime.*
import app.weiban.data.OnboardingDraft
import app.weiban.data.OwnerRecord
import app.weiban.data.SessionRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.launch

internal class OnboardingProgress(
    private val repository: SessionRepository,
    private val owner: OwnerRecord,
    private val scope: CoroutineScope,
) {
    var loaded by mutableStateOf(false)
    var saving by mutableStateOf(false)
    var draft by mutableStateOf<OnboardingDraft?>(null)
    var error by mutableStateOf<String?>(null)

    suspend fun load() {
        error = null
        userAction({ error = "无法读取引导进度，请重试" }) {
            draft = repository.onboardingDraft.load(owner)
            loaded = true
        }
    }

    fun choose(id: String?) {
        if (!loaded || saving) return
        saving = true
        error = null
        scope.launch {
            try {
                userAction({ error = "无法保存引导进度，请稍后重试" }) {
                    val next = id?.let { OnboardingDraft(it) }
                    if (repository.onboardingDraft.save(owner, next)) draft = next
                }
            } finally {
                saving = false
            }
        }
    }

    fun greet(value: String) {
        val next = draft?.copy(greeting = value.take(50)) ?: return
        draft = next
        error = null
        scope.launch {
            userAction({ error = "无法保存招呼草稿，请稍后重试" }) {
                repository.onboardingDraft.save(owner, next)
            }
        }
    }
}

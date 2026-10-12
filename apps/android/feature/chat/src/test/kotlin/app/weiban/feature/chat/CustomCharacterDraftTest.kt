package app.weiban.feature.chat

import app.weiban.contracts.*
import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class CustomCharacterDraftTest {
    @Test fun editingPreservesEveryPhraseStyleBirthdayAvatarAndClassification() {
        val role = role()
        val draft = CustomCharacterDraft(role)
        draft.description += "\n新的背景"
        val input = Json.decodeFromJsonElement<UserCustomCharacterWriteInput>(draft.body())
        assertEquals(role.catchphrases, input.catchphrases)
        assertEquals(role.speechStyle, input.speechStyle)
        assertEquals(role.birthday, input.birthday)
        assertEquals(role.avatar.image?.mediaId, input.avatarMediaId)
        assertEquals(role.tags, input.tags)
        assertEquals("minor", input.classification.ageSetting)
        assertEquals("private_person", input.classification.realPersonKind)
        assertTrue(input.classification.childAppearance)
        assertNull(draft.validationError())
    }

    @Test fun clearingOptionalFieldsProducesExplicitEmptyValues() {
        val draft = CustomCharacterDraft(role())
        draft.phrases = ""
        draft.style = ""
        draft.birthday = ""
        draft.avatarMediaId = null
        draft.tags = ""
        val body = draft.body()
        assertEquals(JsonArray(emptyList()), body["catchphrases"])
        assertEquals(JsonPrimitive(""), body["speechStyle"])
        assertEquals(JsonNull, body["birthday"])
        assertEquals(JsonNull, body["avatarMediaId"])
        assertEquals(JsonArray(emptyList()), body["tags"])
    }

    @Test fun copiedFictionalRoleOnlyOffersSameOrStricterBasis() {
        val fictional = role().copy(classification = role().classification.copy(basis = "fictional", realPersonKind = null))
        val draft = CustomCharacterDraft(fictional).also { it.plazaCopy = true }
        assertTrue(draft.basisAllowed("fictional"))
        assertTrue(draft.basisAllowed("real_person"))
        assertFalse(draft.basisAllowed("original"))
        assertFalse(CustomCharacterDraft(role()).basisAllowed("fictional"))
    }

    @Test fun limitsAndInvalidCalendarDatesAreRejectedBeforeSending() {
        val draft = CustomCharacterDraft(role())
        draft.birthday = "2026-02-30"
        assertNotNull(draft.validationError())
        draft.birthday = "2024-02-29"
        assertNull(draft.validationError())
        draft.phrases = (1..11).joinToString("\n") { "句子$it" }
        assertNotNull(draft.validationError())
        draft.phrases = ""
        draft.tags = "长".repeat(17)
        assertNotNull(draft.validationError())
    }

    private fun role() =
        UserCustomCharacter(
            characterId = "01920000-0000-7000-8000-00000000001f",
            kind = "custom",
            name = "小树",
            avatar =
                CharacterAvatar(
                    CharacterAvatarImage("01920000-0000-7000-8000-000000000099", "/api/v1/media/avatar"),
                    CharacterDisplay(emptyList(), null, "star", null),
                ),
            tagline = "一起看星星",
            tags = listOf("安静", "好奇"),
            categoryId = null,
            basis = "real_person",
            added = false,
            aliases = emptyList(),
            works = emptyList(),
            intro = "一起看星星",
            birthday = "2010-01-02",
            fanName = null,
            classification =
                CharacterClassification(
                    "real_person",
                    "private_person",
                    "minor",
                    true,
                    true,
                    CharacterClassificationDerived(true, false, false, "forbidden", true),
                ),
            showPublicSourceNotice = true,
            personaVersion = 1,
            personaUpdatedUnseen = false,
            description = "喜欢星空，也喜欢安静地听朋友说话。".repeat(5),
            catchphrase = "慢慢来",
            catchphrases = listOf("慢慢来", "一起看看吧"),
            speechStyle = "温和，先听再回应",
            exampleDialogue = "我：看什么？\nTA：星星。",
            childFeaturesDetected = true,
        )
}

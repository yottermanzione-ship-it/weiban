package app.weiban.network

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ContractJsonTest {
    @Test fun rejectsUnsafeMonetaryValuesBeforeRendering() {
        assertTrue(runCatching { ContractJson.normalize("MoneyMicros", JsonPrimitive(9_007_199_254_740_992L)) }.isFailure)
        assertTrue(runCatching { ContractJson.normalize("MoneyMicros", JsonPrimitive(0.1)) }.isFailure)
        assertEquals(JsonPrimitive(5_000_001L), ContractJson.normalize("MoneyMicros", JsonPrimitive(5_000_001L)))
    }

    @Test fun receiverUnknownThemeAndMessageNormalizeButWriterCannotSendFutureType() {
        assertEquals(JsonPrimitive("unsupported"), ContractJson.normalize("ReceivedAppTheme", JsonPrimitive("future-blue")))
        val content = Json.parseToJsonElement("""{"type":"future-hologram","privateExtra":"strip"}""")
        assertEquals(
            Json.parseToJsonElement("""{"type":"unsupported","originalType":"future-hologram"}"""),
            ContractJson.normalize("ReceivedMessageContent", content),
        )
        assertTrue(runCatching { ContractJson.normalize("UserSendableContent", content) }.isFailure)
    }

    @Test fun malformedKnownMessageAndMissingRequiredFieldFail() {
        assertTrue(
            runCatching {
                ContractJson.normalize("ReceivedMessageContent", Json.parseToJsonElement("""{"type":"text","text":""}"""))
            }.isFailure,
        )
        assertTrue(runCatching { ContractJson.normalize("CurrentUser", Json.parseToJsonElement("""{"username":"test_user"}""")) }.isFailure)
    }
}

package app.weiban.contracts

import kotlinx.serialization.json.*
import org.junit.Assert.*
import org.junit.Test

class ContractRoundTripTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test fun unknownContentSurvivesCacheRoundTrip() {
        val input = """{"type":"future-hologram","privateExtra":"discard"}"""
        val content = json.decodeFromString(ReceivedMessageContent.serializer(), input)
        val serialized = json.encodeToString(ReceivedMessageContent.serializer(), content)
        assertEquals(
            json.parseToJsonElement("""{"type":"unsupported","originalType":"future-hologram"}"""),
            json.parseToJsonElement(serialized),
        )
        assertEquals(
            json.parseToJsonElement(serialized),
            json.parseToJsonElement(
                json.encodeToString(
                    ReceivedMessageContent.serializer(),
                    json.decodeFromString(ReceivedMessageContent.serializer(), serialized),
                ),
            ),
        )
    }

    @Test fun unknownUpdateRetainsCursorAndOriginalType() {
        val input =
            """
{
    "updateSeq": 7,
    "occurredAt": "2026-10-06T03:00:00.000Z",
    "type": "future-operation",
    "data": {
        "privateExtra": "discard"
    }
}
            """.trimIndent()
        val update = json.decodeFromString(UserUpdate.serializer(), input)
        val value = json.parseToJsonElement(json.encodeToString(UserUpdate.serializer(), update)).jsonObject
        assertEquals(JsonPrimitive(7), value["updateSeq"])
        assertEquals(buildJsonObject { put("originalType", "future-operation") }, value["data"])
        assertNull(value["originalType"])
    }

    @Test fun sendsIncludeDiscriminatorWithoutEncodingAbsentOptionalFields() {
        val body =
            json.decodeFromString(
                SendMessageRequest.serializer(),
                """
{
    "clientMsgId": "01920000-0000-7000-8000-000000000065",
    "content": {
        "type": "text",
        "text": "hello"
    }
}
                """.trimIndent(),
            )
        val value = json.parseToJsonElement(json.encodeToString(SendMessageRequest.serializer(), body)).jsonObject
        assertEquals(JsonPrimitive("text"), value["content"]!!.jsonObject["type"])
        assertFalse(value.containsKey("quoteMessageId"))
    }
}

package app.weiban.network

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.*
import java.net.URI
import java.time.OffsetDateTime

/** Validates and normalizes the actual exported JSON Schema, including unknown receiver types. */
object ContractJson {
    private val definitions: JsonObject by lazy {
        val resource = ContractJson::class.java.getResourceAsStream("/contracts.json") ?: error("Contract schema missing")
        resource.bufferedReader().use { Json.parseToJsonElement(it.readText()).jsonObject["\$defs"]!!.jsonObject }
    }

    fun normalize(
        name: String,
        value: JsonElement,
    ): JsonElement = walk(definitions.getValue(name).jsonObject, value, 0)

    private fun fail(): Nothing = throw SerializationException("Contract validation failed")

    // Each early exit resolves one schema form before intersection merging.
    @Suppress("ReturnCount")
    private fun schema(value: JsonObject): JsonObject {
        val ref = value["\$ref"]?.jsonPrimitive?.content
        if (ref != null)return schema(definitions.getValue(ref.removePrefix("#/\$defs/")).jsonObject)
        val types = value["type"]
        if (types is JsonArray)return buildJsonObject { put("anyOf", JsonArray(types.map { JsonObject(value + ("type" to it)) })) }
        val intersections = value["allOf"]?.jsonArray ?: return value
        var result =
            buildJsonObject {
                put("type", "object")
                put("properties", buildJsonObject {})
                put("required", JsonArray(emptyList()))
            }
        var union: JsonArray? = null
        for (part in intersections) {
            val s = schema(part.jsonObject)
            val alternatives = s["oneOf"]?.jsonArray ?: s["anyOf"]?.jsonArray
            if (alternatives != null) {
                union = alternatives
                continue
            }
            result = mergeObjects(result, s)
        }
        return if (union == null) {
            result
        } else {
            buildJsonObject {
                put(
                    "oneOf",
                    JsonArray(union.map { mergeObjects(result, schema(it.jsonObject)) }),
                )
            }
        }
    }

    private fun mergeObjects(
        a: JsonObject,
        b: JsonObject,
    ): JsonObject =
        buildJsonObject {
            put("type", "object")
            put("properties", JsonObject((a["properties"]?.jsonObject ?: emptyMap()) + (b["properties"]?.jsonObject ?: emptyMap())))
            put(
                "required",
                JsonArray(
                    (
                        (
                            a["required"]?.jsonArray ?: JsonArray(
                                emptyList(),
                            )
                        ) + (b["required"]?.jsonArray ?: JsonArray(emptyList()))
                    ).distinct(),
                ),
            )
            put("additionalProperties", false)
        }

    private fun walk(
        raw: JsonObject,
        input: JsonElement,
        depth: Int,
    ): JsonElement {
        if (depth > 128) fail()
        val spec = schema(raw)
        val alternatives = spec["oneOf"]?.jsonArray ?: spec["anyOf"]?.jsonArray
        if (alternatives != null) return union(alternatives, input, depth)
        return typed(spec, input, depth)
    }

    private fun tolerantEnum(
        spec: JsonObject,
        input: JsonElement,
    ): JsonElement? {
        spec["const"]?.let { if (input != it) fail() }
        spec["enum"]?.jsonArray?.let { values ->
            if (input !in values) {
                if (input is JsonPrimitive && input.isString && JsonPrimitive("unsupported") in values) {
                    return JsonPrimitive("unsupported")
                }
                fail()
            }
        }
        return null
    }

    private fun typed(
        spec: JsonObject,
        input: JsonElement,
        depth: Int,
    ): JsonElement {
        tolerantEnum(spec, input)?.let { return it }
        return when (spec["type"]?.jsonPrimitive?.content) {
            "null" -> input.also { if (it != JsonNull) fail() }
            "boolean" -> boolean(input)
            "string" -> string(spec, input)
            "integer", "number" -> number(spec, input)
            "array" -> array(spec, input, depth)
            "object" -> obj(spec, input, depth)
            else -> input
        }
    }

    private fun discriminator(spec: JsonObject): JsonElement? =
        spec["properties"]
            ?.jsonObject
            ?.get("type")
            ?.jsonObject
            ?.get("const")

    private fun taggedUnion(
        branches: List<JsonObject>,
        input: JsonObject,
        depth: Int,
    ): JsonElement {
        val tag = input["type"]?.jsonPrimitive?.contentOrNull ?: fail()
        val selected = branches.find { discriminator(it) == JsonPrimitive(tag) }
        val fallback = branches.find { discriminator(it) == JsonPrimitive("unsupported") }
        val normalized =
            if (selected != null) {
                input
            } else {
                if (fallback == null) fail()
                val payload =
                    if (fallback["properties"]!!.jsonObject.containsKey("originalType")) {
                        mapOf("originalType" to JsonPrimitive(tag))
                    } else {
                        mapOf("data" to buildJsonObject { put("originalType", tag) })
                    }
                JsonObject(input + mapOf("type" to JsonPrimitive("unsupported")) + payload)
            }
        return walk(selected ?: fallback!!, normalized, depth + 1)
    }

    private fun union(
        alternatives: JsonArray,
        input: JsonElement,
        depth: Int,
    ): JsonElement {
        val branches = alternatives.map { schema(it.jsonObject) }
        if (input is JsonObject && branches.all { discriminator(it) != null }) {
            return taggedUnion(branches, input, depth)
        }
        val match =
            branches.firstNotNullOfOrNull { part ->
                try {
                    walk(part, input, depth + 1)
                } catch (_: SerializationException) {
                    null
                }
            }
        return match ?: fail()
    }

    private fun string(
        spec: JsonObject,
        input: JsonElement,
    ): JsonElement {
        if (input !is JsonPrimitive || !input.isString) fail()
        val value = input.content
        val size = value.codePointCount(0, value.length)
        if (size < (spec["minLength"]?.jsonPrimitive?.intOrNull ?: 0) ||
            size > (spec["maxLength"]?.jsonPrimitive?.intOrNull ?: Int.MAX_VALUE)
        ) {
            fail()
        }
        spec["pattern"]?.jsonPrimitive?.content?.let { if (!Regex(it).containsMatchIn(value)) fail() }
        when (spec["format"]?.jsonPrimitive?.content) {
            "date-time" ->
                try {
                    OffsetDateTime.parse(value)
                } catch (_: java.time.format.DateTimeParseException) {
                    fail()
                }
            "uri" ->
                try {
                    if (!URI(value).isAbsolute) fail()
                } catch (_: java.net.URISyntaxException) {
                    fail()
                }
        }
        return input
    }

    private fun number(
        spec: JsonObject,
        input: JsonElement,
    ): JsonElement {
        if (input !is JsonPrimitive || input.isString) fail()
        val value = input.doubleOrNull ?: fail()
        if (!value.isFinite()) fail()
        if (spec["type"] == JsonPrimitive("integer") && (input.longOrNull == null || value % 1.0 != 0.0)) fail()
        numberBounds(spec, value)
        return input
    }

    private fun array(
        spec: JsonObject,
        input: JsonElement,
        depth: Int,
    ): JsonElement {
        if (input !is JsonArray) fail()
        if (input.size < (spec["minItems"]?.jsonPrimitive?.intOrNull ?: 0) ||
            input.size > (spec["maxItems"]?.jsonPrimitive?.intOrNull ?: Int.MAX_VALUE)
        ) {
            fail()
        }
        val prefixes = spec["prefixItems"]?.jsonArray
        return JsonArray(
            input.mapIndexed { index, value ->
                val item = prefixes?.getOrNull(index) ?: spec["items"]
                when (item) {
                    null, JsonPrimitive(true) -> value
                    JsonPrimitive(false) -> fail()
                    else -> walk(item.jsonObject, value, depth + 1)
                }
            },
        )
    }

    private fun obj(
        spec: JsonObject,
        input: JsonElement,
        depth: Int,
    ): JsonElement {
        if (input !is JsonObject) fail()
        val properties = spec["properties"]?.jsonObject ?: JsonObject(emptyMap())
        for (required in spec["required"]?.jsonArray ?: JsonArray(emptyList())) {
            if (!input.containsKey(required.jsonPrimitive.content)) fail()
        }
        return buildJsonObject {
            for ((key, value) in input) {
                when (val item = properties[key] ?: spec["additionalProperties"]) {
                    JsonPrimitive(false) -> Unit // Zod object receivers strip unknown keys.
                    null, JsonPrimitive(true) -> put(key, value)
                    else -> put(key, walk(item.jsonObject, value, depth + 1))
                }
            }
        }
    }

    private fun boolean(input: JsonElement): JsonElement {
        if (input !is JsonPrimitive || input.isString || input.booleanOrNull == null) fail()
        return input
    }

    private fun numberBounds(
        spec: JsonObject,
        value: Double,
    ) {
        val minimum = spec["minimum"]?.jsonPrimitive?.doubleOrNull ?: Double.NEGATIVE_INFINITY
        val maximum = spec["maximum"]?.jsonPrimitive?.doubleOrNull ?: Double.POSITIVE_INFINITY
        if (value < minimum || value > maximum) fail()
        if (spec["exclusiveMinimum"]?.jsonPrimitive?.doubleOrNull?.let { value <= it } == true ||
            spec["exclusiveMaximum"]?.jsonPrimitive?.doubleOrNull?.let { value >= it } == true
        ) {
            fail()
        }
    }
}

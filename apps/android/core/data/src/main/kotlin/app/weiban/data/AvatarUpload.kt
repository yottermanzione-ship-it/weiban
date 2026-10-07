package app.weiban.data

import app.weiban.contracts.Endpoints
import app.weiban.contracts.MediaObject
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/** The image and its purpose remain bound to the owner that opened the picker. */
suspend fun uploadAvatar(
    repository: SessionRepository,
    owner: OwnerRecord,
    png: ByteArray,
    purpose: String,
): MediaObject {
    require(purpose == "user_avatar" || purpose == "contact_avatar")
    val multipart =
        MultipartBody
            .Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", "avatar.png", png.toRequestBody("image/png".toMediaType()))
            .build()
    return repository.call(
        Endpoints.mediaEndpointsUpload,
        query = mapOf("purpose" to purpose),
        multipart = multipart,
        options = SessionCallOptions(owner = owner),
    )
}

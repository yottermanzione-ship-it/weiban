package app.weiban.data

import app.weiban.contracts.Endpoints
import app.weiban.contracts.ImportJob
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * 导入任务上传一份文件或一张截图（T-086，ImporterEndpoints.uploadFile）：multipart 字段 file。
 * 文本文件按 text/plain 或 text/csv 上传；截图按原图片类型。
 */
suspend fun uploadImportFile(
    repository: SessionRepository,
    owner: OwnerRecord,
    jobId: String,
    bytes: ByteArray,
    mimeType: String,
    fileName: String,
): ImportJob {
    val multipart =
        MultipartBody
            .Builder()
            .setType(MultipartBody.FORM)
            .addFormDataPart("file", fileName, bytes.toRequestBody(mimeType.toMediaType()))
            .build()
    return repository.call(
        Endpoints.importerEndpointsUploadFile,
        params = mapOf("jobId" to jobId),
        multipart = multipart,
        options = SessionCallOptions(owner = owner, networkOnly = true),
    )
}

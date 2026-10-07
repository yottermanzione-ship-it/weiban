package app.weiban.data

import androidx.room.*
import kotlinx.coroutines.flow.Flow

@Entity(tableName = "owner")
data class OwnerRecord(
    @PrimaryKey val slot: Int = 1,
    val userId: String,
    val sessionId: String,
)

@Entity(tableName = "cache")
data class CacheRecord(
    @PrimaryKey val key: String,
    val value: String,
)

@Entity(tableName = "sync")
data class SyncRecord(
    @PrimaryKey val slot: Int = 1,
    val value: String,
    val revision: Long = 0,
)

@Dao // Explicit Room transaction/read operations remain together as one account-scoped DAO.
@Suppress("TooManyFunctions")
interface LocalDao {
    @Query("SELECT * FROM owner WHERE slot = 1")
    suspend fun owner(): OwnerRecord?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun owner(record: OwnerRecord)

    @Query("SELECT value FROM cache WHERE key = :key")
    suspend fun cache(key: String): String?

    @Query("SELECT value FROM cache WHERE key = :key")
    fun observeCache(key: String): Flow<String?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun cache(record: CacheRecord)

    @Query("SELECT * FROM sync WHERE slot = 1")
    suspend fun sync(): SyncRecord?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun sync(record: SyncRecord)

    @Query("DELETE FROM cache")
    suspend fun clearCache()

    @Query("DELETE FROM sync")
    suspend fun clearSync()

    @Query("DELETE FROM owner")
    suspend fun clearOwner()

    @Transaction suspend fun replaceOwner(record: OwnerRecord?) {
        clearCache()
        clearSync()
        clearOwner()
        if (record != null)owner(record)
    }
}

@Database(entities = [OwnerRecord::class, CacheRecord::class, SyncRecord::class], version = 1, exportSchema = true)
abstract class LocalDatabase : RoomDatabase() {
    abstract fun local(): LocalDao
}

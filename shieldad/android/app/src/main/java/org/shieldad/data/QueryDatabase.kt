package org.shieldad.data

import android.content.Context
import androidx.room.Dao
import androidx.room.Database
import androidx.room.Entity
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.PrimaryKey
import androidx.room.Query
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.withTransaction
import java.util.Calendar
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

@Entity(tableName = "query_log")
data class QueryLogEntity(
    @PrimaryKey(autoGenerate = true) val id: Long = 0,
    val domain: String,
    val blocked: Boolean,
    val timestamp: Long = System.currentTimeMillis()
)

@Entity(tableName = "query_stats")
data class QueryStatsEntity(
    @PrimaryKey val id: Int = 1,
    val totalBlocked: Long = 0,
    val dayStart: Long = 0,
    val blockedToday: Long = 0
)

@Dao
interface QueryLogDao {
    @Query("SELECT * FROM query_log ORDER BY timestamp DESC, id DESC LIMIT 100")
    fun recentQueries(): Flow<List<QueryLogEntity>>

    @Query("SELECT * FROM query_stats WHERE id = 1")
    fun observeStats(): Flow<QueryStatsEntity?>

    @Query("SELECT * FROM query_stats WHERE id = 1")
    suspend fun stats(): QueryStatsEntity?

    @Insert suspend fun insert(entry: QueryLogEntity): Long

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun saveStats(stats: QueryStatsEntity)

    @Query("DELETE FROM query_log WHERE id NOT IN (SELECT id FROM query_log ORDER BY timestamp DESC, id DESC LIMIT 1000)")
    suspend fun prune()
}

@Database(entities = [QueryLogEntity::class, QueryStatsEntity::class], version = 1, exportSchema = true)
abstract class QueryDatabase : RoomDatabase() {
    abstract fun queries(): QueryLogDao

    companion object {
        fun create(context: Context): QueryDatabase = Room.databaseBuilder(context, QueryDatabase::class.java, "shieldad.db").build()
    }
}

fun startOfToday(timestamp: Long = System.currentTimeMillis()): Long = Calendar.getInstance().run {
    timeInMillis = timestamp
    set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    timeInMillis
}

class StatsRepository(private val database: QueryDatabase) {
    val recent = database.queries().recentQueries()
    val totalBlocked = database.queries().observeStats().map { it?.totalBlocked ?: 0 }
    val blockedToday = database.queries().observeStats().map {
        if (it?.dayStart == startOfToday()) it.blockedToday else 0
    }

    suspend fun record(domain: String, blocked: Boolean) {
        database.withTransaction {
            val now = System.currentTimeMillis()
            database.queries().insert(QueryLogEntity(domain = domain, blocked = blocked, timestamp = now))
            database.queries().prune()
            if (blocked) {
                val previous = database.queries().stats()
                val today = startOfToday(now)
                database.queries().saveStats(QueryStatsEntity(
                    totalBlocked = (previous?.totalBlocked ?: 0) + 1,
                    dayStart = today,
                    blockedToday = if (previous?.dayStart == today) previous.blockedToday + 1 else 1
                ))
            }
        }
    }
}

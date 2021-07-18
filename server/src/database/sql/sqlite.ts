import { SqlConnector, SqlQueryOptions, SqlQuery, SqlModificationResult } from './sql';
import SqliteDb from 'better-sqlite3';

export interface SqliteRunResult {}

export interface SqliteStatement {
  run: (...values: unknown[]) => unknown;
  all: (...values: unknown[]) => unknown[]
}

export type SqliteTransactionCallback = (callback: () => unknown[][]) => (() => unknown[][]);

export interface SqliteDbType {
  prepare: (sql: string) => SqliteStatement;
  transaction: SqliteTransactionCallback;
  pragma: (sql: string) => void;
  close: () => void;
}

export class SqliteConnector extends SqlConnector {
  // The types are broken. https://github.com/DefinitelyTyped/DefinitelyTyped/issues/52163
  protected readonly database: SqliteDbType;

  // public for tests
  public query(queries: SqlQuery[], options?: SqlQueryOptions): Promise<unknown[][]> {
    const statements = (): unknown[][] => {
      return queries.map(query => {
        const statement = this.database.prepare(query.sql);
        if (query.run) {
          const updateResult = statement.run(...(query.values || [])) as { changes: number, lastInsertRowid: number };
          const res: SqlModificationResult = { modifiedCount: updateResult.changes };
          return [ res ];
        } else {
          return statement.all(...(query.values || []));
        }
      });
    };
    if (options?.transaction) {
      return Promise.resolve(this.database.transaction(statements)());
    } else {
      return Promise.resolve(statements());
    }
  }

  public static async init(file: string): Promise<SqliteConnector> {
    const db = new SqliteDb(file) as unknown as SqliteDbType;
    db.pragma('strict = ON');
    const connector = new SqliteConnector(db);
    await connector.update();
    return connector;
  }

  public close(): Promise<void> {
    this.database.close();
    return Promise.resolve();
  }

  private constructor(database: SqliteDbType) {
    super();
    this.database = database;
  }
}

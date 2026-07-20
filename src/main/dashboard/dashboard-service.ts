import type {
  AccountRecord,
  AccountSnapshot,
} from '../../shared/ipc/bridge';
import type { AccountService } from '../accounts/account-service';
import type { OperationRepository } from '../storage/repositories/operation-repository';
import type { SnapshotRepository } from '../storage/repositories/snapshot-repository';

type AccountServicePort = Pick<AccountService, 'list'>;
type SnapshotRepositoryPort = Pick<SnapshotRepository, 'getLatest'>;
type OperationRepositoryPort = Pick<OperationRepository, 'listRecent'>;

export interface DashboardOperation {
  kind: string;
  status: 'success' | 'error';
  startedAt: string;
  errorCode?: string;
  errorSummary?: string;
}

export interface DashboardAccount {
  account: AccountRecord;
  snapshots: AccountSnapshot[];
  operations: DashboardOperation[];
}

export interface DashboardOverview {
  accounts: DashboardAccount[];
}

/**
 * 为总览提供仅含可展示字段的本地投影。
 * 只读取账户、非敏感快照和已经脱敏的操作摘要，绝不外泄数据库内部字段或响应体。
 */
export class DashboardService {
  constructor(private readonly deps: {
    accountService: AccountServicePort;
    snapshotRepository: SnapshotRepositoryPort;
    operationRepository: OperationRepositoryPort;
  }) {}

  getOverview(): DashboardOverview {
    return {
      accounts: this.deps.accountService.list().map(account => ({
        account,
        snapshots: this.deps.snapshotRepository.getLatest(account.id).map(snapshot => ({
          kind: snapshot.kind,
          payloadJson: snapshot.payloadJson,
          semanticUnit: snapshot.semanticUnit,
          fetchedAt: snapshot.fetchedAt,
        })),
        operations: this.deps.operationRepository.listRecent(account.id, 5).map(operation => ({
          kind: operation.kind,
          status: operation.status,
          startedAt: operation.startedAt,
          errorCode: operation.errorCode,
          errorSummary: operation.errorSummary,
        })),
      })),
    };
  }
}

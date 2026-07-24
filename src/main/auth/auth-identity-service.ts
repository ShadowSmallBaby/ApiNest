import type { AuthIdentity, AuthKind } from '../../shared/ipc/bridge';
import { AppError } from '../../shared/ipc/errors';
import type { AuthIdentityRepository, AuthIdentityEntity } from '../storage/repositories/auth-identity-repository';
import type { SiteCredentialService, SiteCredentialPlaintext } from './site-credential-service';

/**
 * auth 身份领域服务（R13 演进）。
 *
 * auth 身份是独立一等实体：github/linuxdo 为分类标签（不存任何凭据），
 * password 为可被多个账户引用的账密凭据（明文走 vault 加密，绝不入普通字段/日志/UI）。
 *
 * 本服务只处理身份的 CRUD 与 password 凭据的存/删/存在性；明文凭据的读取
 * 仅供主进程内表单填充，由 SiteCredentialService 负责，绝不经此服务回传 Renderer。
 */

export interface CreateAuthIdentityInput {
  kind: AuthKind;
  label: string;
  note?: string;
  useProxy?: boolean;
}

export interface UpdateAuthIdentityInput {
  label?: string;
  note?: string;
  useProxy?: boolean;
}

type CredentialPort = Pick<SiteCredentialService, 'save' | 'has' | 'clear'>;

export interface AuthIdentityServiceDependencies {
  repository: AuthIdentityRepository;
  credentials: CredentialPort;
  generateId?: () => string;
  /** 网络策略失效端口（阶段 6）：auth 身份切换 useProxy 后使其 auth partition 热切换。 */
  networkInvalidator?: { invalidateAuth(authId: string): void };
}

function toView(entity: AuthIdentityEntity, hasCredential: boolean): AuthIdentity {
  return {
    id: entity.id,
    kind: entity.kind as AuthKind,
    label: entity.label,
    note: entity.note,
    hasCredential,
    useProxy: entity.useProxy,
    createdAt: entity.createdAt,
  };
}

export class AuthIdentityService {
  private readonly generateId: () => string;

  constructor(private readonly deps: AuthIdentityServiceDependencies) {
    this.generateId = deps.generateId ?? (() => crypto.randomUUID());
  }

  /** 列出全部 auth 身份；password 类型附带凭据存在性（仅布尔）。 */
  list(): AuthIdentity[] {
    return this.deps.repository.list().map(entity => this.attachCredentialFlag(entity));
  }

  get(id: string): AuthIdentity {
    const entity = this.deps.repository.get(id);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }
    return this.attachCredentialFlag(entity);
  }

  create(input: CreateAuthIdentityInput): AuthIdentity {
    const now = new Date().toISOString();
    const entity: AuthIdentityEntity = {
      id: this.generateId(),
      kind: input.kind,
      label: input.label,
      note: input.note,
      useProxy: input.useProxy ?? false,
      createdAt: now,
      updatedAt: now,
    };
    this.deps.repository.create(entity);
    return toView(entity, false);
  }

  update(id: string, input: UpdateAuthIdentityInput): AuthIdentity {
    const entity = this.deps.repository.get(id);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }

    const updated: AuthIdentityEntity = {
      ...entity,
      label: input.label ?? entity.label,
      note: input.note ?? entity.note,
      useProxy: input.useProxy ?? entity.useProxy,
      updatedAt: new Date().toISOString(),
    };
    this.deps.repository.update(updated);
    // useProxy 变化：使该 auth 身份 partition 的代理策略失效，下次登录窗口前热切换。
    if (updated.useProxy !== entity.useProxy) {
      this.deps.networkInvalidator?.invalidateAuth(id);
    }
    return this.attachCredentialFlag(updated);
  }

  /** 删除 auth 身份；password 类型同步清除其加密凭据。账户引用由 DB ON DELETE SET NULL 解除。 */
  remove(id: string): void {
    const entity = this.deps.repository.get(id);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }

    if (entity.kind === 'password') {
      this.deps.credentials.clear(id);
    }
    this.deps.repository.delete(id);
  }

  /** 保存/更新 password 类型身份的账密引用。明文一次性加密落盘，绝不回传。 */
  saveCredential(id: string, plaintext: SiteCredentialPlaintext): void {
    const entity = this.deps.repository.get(id);
    if (!entity) {
      throw new AppError('ACCOUNT_NOT_FOUND', 'Auth identity was not found.');
    }
    if (entity.kind !== 'password') {
      throw new AppError('INVALID_ARGUMENT', 'Credentials apply only to password identities.');
    }
    this.deps.credentials.save(id, plaintext);
  }

  /** 该身份是否已保存凭据（仅布尔存在性）。 */
  hasCredential(id: string): boolean {
    return this.deps.credentials.has(id);
  }

  private attachCredentialFlag(entity: AuthIdentityEntity): AuthIdentity {
    const hasCredential = entity.kind === 'password' && this.deps.credentials.has(entity.id);
    return toView(entity, hasCredential);
  }
}

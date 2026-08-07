import { describe, expect, it } from 'vitest';
import { createUpdateUserRoleUseCase } from './update-user-role.js';
import { AdminUserNotFoundError } from '../domain/index.js';
import {
  buildAdminUser,
  createInMemoryAuditLogRepository,
  createInMemoryUserRoleRepository,
} from './__fixtures__/fakes.js';

function setup() {
  const userRoleRepository = createInMemoryUserRoleRepository();
  const auditLogRepository = createInMemoryAuditLogRepository();
  const updateUserRole = createUpdateUserRoleUseCase({ userRoleRepository, auditLogRepository });
  return { userRoleRepository, auditLogRepository, updateUserRole };
}

describe('updateUserRole', () => {
  it('updates the role and returns the updated user', async () => {
    const { userRoleRepository, updateUserRole } = setup();
    const target = buildAdminUser({ id: 'target-1', role: 'CUSTOMER' });
    const actor = buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });
    userRoleRepository.seed(target);
    userRoleRepository.seed(actor);

    const result = await updateUserRole({
      actorId: 'admin-1',
      userId: 'target-1',
      role: 'COURIER',
    });

    expect(result.role).toBe('COURIER');
    expect((await userRoleRepository.findById('target-1'))?.role).toBe('COURIER');
  });

  it('records an audit log entry with the acting admin, previous role, and new role', async () => {
    const { userRoleRepository, auditLogRepository, updateUserRole } = setup();
    userRoleRepository.seed(buildAdminUser({ id: 'target-1', role: 'CUSTOMER' }));
    userRoleRepository.seed(
      buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' }),
    );

    await updateUserRole({ actorId: 'admin-1', userId: 'target-1', role: 'FLEET_MANAGER' });

    expect(auditLogRepository.all()).toMatchObject([
      {
        actorId: 'admin-1',
        actorLabel: 'admin@example.com',
        action: 'user.role_updated',
        entityType: 'User',
        entityId: 'target-1',
        metadata: { previousRole: 'CUSTOMER', newRole: 'FLEET_MANAGER' },
      },
    ]);
  });

  it('throws AdminUserNotFoundError for an unknown target user', async () => {
    const { updateUserRole } = setup();

    await expect(
      updateUserRole({ actorId: 'admin-1', userId: 'missing', role: 'ADMIN' }),
    ).rejects.toBeInstanceOf(AdminUserNotFoundError);
  });
});

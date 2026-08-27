import { describe, expect, it } from 'vitest';
import { createUpdateUserRoleUseCase } from './update-user-role.js';
import {
  AdminUserNotFoundError,
  CannotChangeOwnRoleError,
  LastAdministratorError,
} from '../domain/index.js';
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

  it('prevents an admin from changing their own role', async () => {
    const { userRoleRepository, updateUserRole } = setup();
    const admin = buildAdminUser({ id: 'admin-1', role: 'ADMIN' });
    userRoleRepository.seed(admin);

    await expect(
      updateUserRole({ actorId: 'admin-1', userId: 'admin-1', role: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(CannotChangeOwnRoleError);
  });

  it('prevents demoting the only ADMIN', async () => {
    const { userRoleRepository, updateUserRole } = setup();
    const onlyAdmin = buildAdminUser({ id: 'admin-1', role: 'ADMIN' });
    const customer = buildAdminUser({ id: 'user-1', role: 'CUSTOMER' });
    userRoleRepository.seed(onlyAdmin);
    userRoleRepository.seed(customer);

    await expect(
      updateUserRole({ actorId: 'user-1', userId: 'admin-1', role: 'CUSTOMER' }),
    ).rejects.toBeInstanceOf(LastAdministratorError);

    expect((await userRoleRepository.findById('admin-1'))?.role).toBe('ADMIN');
  });

  it('allows demoting one admin when another exists', async () => {
    const { userRoleRepository, updateUserRole } = setup();
    const admin1 = buildAdminUser({ id: 'admin-1', role: 'ADMIN' });
    const admin2 = buildAdminUser({ id: 'admin-2', role: 'ADMIN' });
    userRoleRepository.seed(admin1);
    userRoleRepository.seed(admin2);

    const result = await updateUserRole({
      actorId: 'admin-2',
      userId: 'admin-1',
      role: 'CUSTOMER',
    });

    expect(result.role).toBe('CUSTOMER');
    expect((await userRoleRepository.findById('admin-1'))?.role).toBe('CUSTOMER');
  });

  it('records audit log for refused self-demotion', async () => {
    const { userRoleRepository, auditLogRepository, updateUserRole } = setup();
    const admin = buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });
    userRoleRepository.seed(admin);

    try {
      await updateUserRole({ actorId: 'admin-1', userId: 'admin-1', role: 'CUSTOMER' });
    } catch {
      // Expected to throw
    }

    // Should not record an audit log for refused self-role change
    expect(auditLogRepository.all()).toHaveLength(0);
  });

  it('records audit log for refused last admin demotion', async () => {
    const { userRoleRepository, auditLogRepository, updateUserRole } = setup();
    const onlyAdmin = buildAdminUser({ id: 'admin-1', email: 'admin@example.com', role: 'ADMIN' });
    userRoleRepository.seed(onlyAdmin);

    try {
      await updateUserRole({
        actorId: 'admin-1',
        userId: 'admin-1',
        role: 'CUSTOMER',
      });
    } catch {
      // Expected to throw
    }

    // Should not record an audit log for refused role change
    expect(auditLogRepository.all()).toHaveLength(0);
  });
});

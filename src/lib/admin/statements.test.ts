import { describe, expect, it } from 'vitest';
import { primaryStatusSql, replicaField, replicaHostsSql, replicaStatusSql } from './statements';

describe('statement selection', () => {
	const mysql84 = { serverType: 'MySQL', versionInt: 80404 };
	const mysql80 = { serverType: 'MySQL', versionInt: 80021 };
	const mysql8022 = { serverType: 'MySQL', versionInt: 80022 };
	const mysql57 = { serverType: 'MySQL', versionInt: 50744 };
	const maria114 = { serverType: 'MariaDB', versionInt: 110402 };
	const maria103 = { serverType: 'MariaDB', versionInt: 100322 };

	it('primary status', () => {
		expect(primaryStatusSql(mysql84)).toBe('SHOW BINARY LOG STATUS');
		expect(primaryStatusSql({ serverType: 'MySQL', versionInt: 80200 })).toBe(
			'SHOW BINARY LOG STATUS'
		);
		expect(primaryStatusSql(mysql80)).toBe('SHOW MASTER STATUS');
		expect(primaryStatusSql(maria114)).toBe('SHOW MASTER STATUS');
	});
	it('replica status', () => {
		expect(replicaStatusSql(mysql84)).toBe('SHOW REPLICA STATUS');
		expect(replicaStatusSql(mysql8022)).toBe('SHOW REPLICA STATUS');
		expect(replicaStatusSql(mysql80)).toBe('SHOW SLAVE STATUS');
		expect(replicaStatusSql(mysql57)).toBe('SHOW SLAVE STATUS');
		expect(replicaStatusSql(maria114)).toBe('SHOW REPLICA STATUS');
		expect(replicaStatusSql(maria103)).toBe('SHOW SLAVE STATUS');
	});
	it('replica hosts', () => {
		expect(replicaHostsSql(mysql84)).toBe('SHOW REPLICAS');
		expect(replicaHostsSql(mysql57)).toBe('SHOW SLAVE HOSTS');
		expect(replicaHostsSql(maria114)).toBe('SHOW SLAVE HOSTS');
	});
	it('replicaField reads either column name', () => {
		expect(replicaField({ Replica_IO_Running: 'Yes' }, 'Slave_IO_Running')).toBe('Yes');
		expect(replicaField({ Slave_IO_Running: 'No' }, 'Slave_IO_Running')).toBe('No');
		expect(replicaField({}, 'Slave_IO_Running')).toBe('');
	});
});

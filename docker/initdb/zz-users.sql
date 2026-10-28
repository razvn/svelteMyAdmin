-- phpMyAdmin control user (configuration storage in `phpmyadmin`, see create_tables.sql).
-- Password: pmapass
CREATE USER IF NOT EXISTS 'pma'@'%' IDENTIFIED BY 'pmapass';
GRANT USAGE ON *.* TO 'pma'@'%';
GRANT SELECT, INSERT, UPDATE, DELETE, ALTER ON `phpmyadmin`.* TO 'pma'@'%';
-- Needed so the control user can read table metadata of the fixture database.
GRANT SELECT ON `sma_test`.* TO 'pma'@'%';
FLUSH PRIVILEGES;

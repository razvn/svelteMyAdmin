-- Fixture of the SQL export tests (@DB@ is replaced by the temporary database).
CREATE TABLE @DB@.`parent` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(50) NOT NULL COMMENT 'The "name" of it',
  `kind` enum('a','b','c') NOT NULL DEFAULT 'a',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_name` (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='Parents';

CREATE TABLE @DB@.`child` (
  `id` int NOT NULL AUTO_INCREMENT,
  `parent_id` int NOT NULL,
  `note` text,
  `data` blob,
  `bits` bit(8) DEFAULT NULL,
  `geo` geometry DEFAULT NULL,
  `doc` json DEFAULT NULL,
  `amount` decimal(10,2) DEFAULT NULL,
  `ratio` double DEFAULT NULL,
  `created` timestamp NOT NULL DEFAULT '2024-01-02 03:04:05',
  `flags` set('x','y','z') DEFAULT NULL,
  `bin` varbinary(16) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_parent` (`parent_id`),
  FULLTEXT KEY `ft_note` (`note`),
  CONSTRAINT `fk_child_parent` FOREIGN KEY (`parent_id`) REFERENCES `parent` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE @DB@.`audit` (
  `id` int NOT NULL AUTO_INCREMENT,
  `msg` varchar(255) NOT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO @DB@.`parent` (`id`, `name`, `kind`) VALUES (1, 'O''Brien "quoted" \\ back', 'b'), (2, 'Zoë émoji 😀', 'c'), (5, 'plain', 'a');

INSERT INTO @DB@.`child` (`id`, `parent_id`, `note`, `data`, `bits`, `geo`, `doc`, `amount`, `ratio`, `created`, `flags`, `bin`) VALUES
 (1, 1, 'line1\nline2\ttab', 0x00FF10, b'10101010', ST_GeomFromText('POINT(1 2)'), '{"k": [1, 2, {"n": null}]}', 12.50, 0.1, '2024-02-29 13:45:10', 'x,z', 0x0A),
 (2, 2, NULL, '', NULL, NULL, NULL, NULL, 1e-7, '2024-03-01 00:00:00', NULL, NULL),
 (7, 5, '0', 0x30, b'00000001', ST_GeomFromText('POINT(3 4)'), 'null', -0.01, 123456789.123456, '2024-03-02 01:02:03', 'y', X'');

CREATE VIEW @DB@.`v_child` AS SELECT c.`id` AS `child_id`, p.`name` AS `parent_name`, COUNT(*) AS `n` FROM @DB@.`child` c JOIN @DB@.`parent` p ON p.`id` = c.`parent_id` WHERE c.`note` <> 'x and y from where' GROUP BY c.`id`, p.`name`;

DELIMITER $$

CREATE PROCEDURE @DB@.`sp_children`(IN p_parent INT)
BEGIN
  SELECT * FROM `child` WHERE `parent_id` = p_parent ORDER BY `id`;
END$$

CREATE FUNCTION @DB@.`fn_count`(p_parent INT) RETURNS int
  READS SQL DATA
  DETERMINISTIC
BEGIN
  DECLARE n INT;
  SELECT COUNT(*) INTO n FROM `child` WHERE `parent_id` = p_parent;
  RETURN n;
END$$

CREATE TRIGGER @DB@.`trg_child_ai` AFTER INSERT ON @DB@.`child`
FOR EACH ROW
BEGIN
  INSERT INTO `audit` (`msg`) VALUES (CONCAT('child: ', NEW.`id`));
END$$

CREATE EVENT @DB@.`ev_cleanup`
  ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00'
  DISABLE
  COMMENT 'Purge'
  DO DELETE FROM `audit` WHERE `id` < 0$$

DELIMITER ;

-- Fixture database used by integration tests. Works on MySQL 8.4 and MariaDB 11.4.
-- The mysql client in the MySQL image defaults to latin1; force UTF-8 so non-ASCII data is not double-encoded.
SET NAMES utf8mb4;
CREATE DATABASE IF NOT EXISTS `sma_test` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `sma_test`;

CREATE TABLE `authors` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `born` date DEFAULT NULL,
  `bio` text,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_authors_name` (`name`)
) ENGINE=InnoDB COMMENT='Book authors';

CREATE TABLE `books` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `author_id` int unsigned NOT NULL,
  `title` varchar(200) NOT NULL,
  `price` decimal(8,2) NOT NULL DEFAULT '0.00',
  `published_at` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` enum('draft','published','archived') NOT NULL DEFAULT 'draft',
  PRIMARY KEY (`id`),
  KEY `idx_books_author` (`author_id`),
  FULLTEXT KEY `ft_books_title` (`title`),
  CONSTRAINT `fk_books_author` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB;

CREATE TABLE `type_zoo` (
  `id` int NOT NULL AUTO_INCREMENT,
  `c_tinyint` tinyint NOT NULL DEFAULT 0,
  `c_smallint` smallint DEFAULT NULL,
  `c_mediumint` mediumint DEFAULT NULL,
  `c_int` int DEFAULT NULL,
  `c_bigint` bigint DEFAULT NULL,
  `c_bigint_u` bigint unsigned DEFAULT NULL,
  `c_bool` tinyint(1) DEFAULT NULL,
  `c_decimal` decimal(20,6) DEFAULT NULL,
  `c_float` float DEFAULT NULL,
  `c_double` double DEFAULT NULL,
  `c_char` char(10) DEFAULT NULL,
  `c_varchar` varchar(255) DEFAULT NULL,
  `c_tinytext` tinytext,
  `c_text` text,
  `c_mediumtext` mediumtext,
  `c_longtext` longtext,
  `c_binary` binary(8) DEFAULT NULL,
  `c_varbinary` varbinary(64) DEFAULT NULL,
  `c_blob` blob,
  `c_longblob` longblob,
  `c_date` date DEFAULT NULL,
  `c_time` time DEFAULT NULL,
  `c_datetime` datetime(3) DEFAULT NULL,
  `c_timestamp` timestamp NULL DEFAULT NULL,
  `c_year` year DEFAULT NULL,
  `c_enum` enum('small','medium','large') DEFAULT 'medium',
  `c_set` set('a','b','c','d') DEFAULT NULL,
  `c_bit` bit(8) DEFAULT NULL,
  `c_json` json DEFAULT NULL,
  `c_geometry` geometry DEFAULT NULL,
  `c_point` point DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

INSERT INTO `authors` (`id`, `name`, `born`, `bio`) VALUES
  (1, 'Ursula K. Le Guin', '1929-10-21', 'American author of speculative fiction.'),
  (2, 'Stanisław Lem', '1921-09-12', NULL),
  (3, 'O''Brien; "Quoted" \\ Name', NULL, 'Tricky characters: '' " \\ ; -- #');

INSERT INTO `books` (`id`, `author_id`, `title`, `price`, `published_at`, `status`) VALUES
  (1, 1, 'The Left Hand of Darkness', 9.99, '1969-03-01 00:00:00', 'published'),
  (2, 1, 'The Dispossessed', 12.50, '1974-05-01 00:00:00', 'published'),
  (3, 2, 'Solaris', 8.75, '1961-01-01 00:00:00', 'archived'),
  (4, 2, 'Unpublished Draft', 0.00, NULL, 'draft');

INSERT INTO `type_zoo` VALUES (
  1, 127, -32768, 8388607, 2147483647, 9223372036854775807, 18446744073709551615, 1,
  12345678901234.123456, 1.5, 2.718281828459045,
  'char', 'varchar éè', 'tiny', 'text', 'medium', 'long',
  0x0102030405060708, 0xDEADBEEF, 0x00FF10, 0x00,
  '2024-02-29', '-12:34:56', '2024-02-29 13:45:10.123', '2024-02-29 13:45:10', 2024,
  'large', 'a,c', b'10101010', '{"k": [1, 2, {"n": null}], "s": "v"}',
  ST_GeomFromText('POINT(1 2)'), ST_GeomFromText('POINT(3 4)')
);
INSERT INTO `type_zoo` (`id`) VALUES (2);

CREATE VIEW `v_book_authors` AS
  SELECT b.`id` AS `book_id`, b.`title`, a.`name` AS `author`
  FROM `books` b JOIN `authors` a ON a.`id` = b.`author_id`;

CREATE TABLE `audit_log` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `message` varchar(255) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

DELIMITER $$

CREATE PROCEDURE `sp_books_by_author`(IN p_author_id INT)
BEGIN
  SELECT * FROM `books` WHERE `author_id` = p_author_id ORDER BY `id`;
END$$

CREATE FUNCTION `fn_book_count`(p_author_id INT) RETURNS int
  READS SQL DATA
  DETERMINISTIC
BEGIN
  DECLARE n INT;
  SELECT COUNT(*) INTO n FROM `books` WHERE `author_id` = p_author_id;
  RETURN n;
END$$

CREATE TRIGGER `trg_books_after_insert` AFTER INSERT ON `books`
FOR EACH ROW
BEGIN
  INSERT INTO `audit_log` (`message`) VALUES (CONCAT('book inserted: ', NEW.`title`));
END$$

CREATE EVENT `ev_cleanup_audit_log`
  ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00'
  DISABLE
  COMMENT 'Purge old audit rows'
  DO DELETE FROM `audit_log` WHERE `created_at` < NOW() - INTERVAL 30 DAY$$

DELIMITER ;

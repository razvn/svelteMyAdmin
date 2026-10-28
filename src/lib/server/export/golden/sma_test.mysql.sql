-- svelteMyAdmin SQL Dump
-- version 0.0.1
--
-- Host: <Host>
-- Generation Time: <Generation Time>
-- Server version: <Server version>
-- Node.js Version: <Node.js Version>

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";


/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;

--
-- Database: `sma_test`
--

DELIMITER $$
--
-- Procedures
--
CREATE DEFINER=`root`@`localhost` PROCEDURE `sp_books_by_author`(IN p_author_id INT)
BEGIN
  SELECT * FROM `books` WHERE `author_id` = p_author_id ORDER BY `id`;
END$$

--
-- Functions
--
CREATE DEFINER=`root`@`localhost` FUNCTION `fn_book_count`(p_author_id INT) RETURNS int
    READS SQL DATA
    DETERMINISTIC
BEGIN
  DECLARE n INT;
  SELECT COUNT(*) INTO n FROM `books` WHERE `author_id` = p_author_id;
  RETURN n;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `audit_log`
--

CREATE TABLE `audit_log` (
  `id` int unsigned NOT NULL,
  `message` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- --------------------------------------------------------

--
-- Table structure for table `authors`
--

CREATE TABLE `authors` (
  `id` int unsigned NOT NULL,
  `name` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `born` date DEFAULT NULL,
  `bio` text COLLATE utf8mb4_unicode_ci
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Book authors';

--
-- Dumping data for table `authors`
--

INSERT INTO `authors` (`id`, `name`, `born`, `bio`) VALUES
(1, 'Ursula K. Le Guin', '1929-10-21', 'American author of speculative fiction.'),
(2, 'Stanisław Lem', '1921-09-12', NULL),
(3, 'O\'Brien; \"Quoted\" \\ Name', NULL, 'Tricky characters: \' \" \\ ; -- #');

-- --------------------------------------------------------

--
-- Table structure for table `books`
--

CREATE TABLE `books` (
  `id` int unsigned NOT NULL,
  `author_id` int unsigned NOT NULL,
  `title` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `price` decimal(8,2) NOT NULL DEFAULT '0.00',
  `published_at` datetime DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `status` enum('draft','published','archived') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'draft'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `books`
--

INSERT INTO `books` (`id`, `author_id`, `title`, `price`, `published_at`, `updated_at`, `status`) VALUES
(1, 1, 'The Left Hand of Darkness', 9.99, '1969-03-01 00:00:00', '<DATETIME>', 'published'),
(2, 1, 'The Dispossessed', 12.50, '1974-05-01 00:00:00', '<DATETIME>', 'published'),
(3, 2, 'Solaris', 8.75, '1961-01-01 00:00:00', '<DATETIME>', 'archived'),
(4, 2, 'Unpublished Draft', 0.00, NULL, '<DATETIME>', 'draft');

--
-- Triggers `books`
--
DELIMITER $$
CREATE TRIGGER `trg_books_after_insert` AFTER INSERT ON `books` FOR EACH ROW BEGIN
  INSERT INTO `audit_log` (`message`) VALUES (CONCAT('book inserted: ', NEW.`title`));
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `type_zoo`
--

CREATE TABLE `type_zoo` (
  `id` int NOT NULL,
  `c_tinyint` tinyint NOT NULL DEFAULT '0',
  `c_smallint` smallint DEFAULT NULL,
  `c_mediumint` mediumint DEFAULT NULL,
  `c_int` int DEFAULT NULL,
  `c_bigint` bigint DEFAULT NULL,
  `c_bigint_u` bigint unsigned DEFAULT NULL,
  `c_bool` tinyint(1) DEFAULT NULL,
  `c_decimal` decimal(20,6) DEFAULT NULL,
  `c_float` float DEFAULT NULL,
  `c_double` double DEFAULT NULL,
  `c_char` char(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `c_varchar` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `c_tinytext` tinytext COLLATE utf8mb4_unicode_ci,
  `c_text` text COLLATE utf8mb4_unicode_ci,
  `c_mediumtext` mediumtext COLLATE utf8mb4_unicode_ci,
  `c_longtext` longtext COLLATE utf8mb4_unicode_ci,
  `c_binary` binary(8) DEFAULT NULL,
  `c_varbinary` varbinary(64) DEFAULT NULL,
  `c_blob` blob,
  `c_longblob` longblob,
  `c_date` date DEFAULT NULL,
  `c_time` time DEFAULT NULL,
  `c_datetime` datetime(3) DEFAULT NULL,
  `c_timestamp` timestamp NULL DEFAULT NULL,
  `c_year` year DEFAULT NULL,
  `c_enum` enum('small','medium','large') COLLATE utf8mb4_unicode_ci DEFAULT 'medium',
  `c_set` set('a','b','c','d') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `c_bit` bit(8) DEFAULT NULL,
  `c_json` json DEFAULT NULL,
  `c_geometry` geometry DEFAULT NULL,
  `c_point` point DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

--
-- Dumping data for table `type_zoo`
--

INSERT INTO `type_zoo` (`id`, `c_tinyint`, `c_smallint`, `c_mediumint`, `c_int`, `c_bigint`, `c_bigint_u`, `c_bool`, `c_decimal`, `c_float`, `c_double`, `c_char`, `c_varchar`, `c_tinytext`, `c_text`, `c_mediumtext`, `c_longtext`, `c_binary`, `c_varbinary`, `c_blob`, `c_longblob`, `c_date`, `c_time`, `c_datetime`, `c_timestamp`, `c_year`, `c_enum`, `c_set`, `c_bit`, `c_json`, `c_geometry`, `c_point`) VALUES
(1, 127, -32768, 8388607, 2147483647, 9223372036854775807, 18446744073709551615, 1, 12345678901234.123456, 1.5, 2.718281828459045, 'char', 'varchar éè', 'tiny', 'text', 'medium', 'long', 0x0102030405060708, 0xdeadbeef, 0x00ff10, 0x00, '2024-02-29', '-12:34:56', '2024-02-29 13:45:10.123', '<DATETIME>', '2024', 'large', 'a,c', b'10101010', '{\"k\": [1, 2, {\"n\": null}], \"s\": \"v\"}', 0x000000000101000000000000000000f03f0000000000000040, 0x00000000010100000000000000000008400000000000001040),
(2, 0, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'medium', NULL, NULL, NULL, NULL, NULL);

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_book_authors`
-- (See below for the actual view)
--
CREATE TABLE `v_book_authors` (
`book_id` int unsigned
,`title` varchar(200)
,`author` varchar(100)
);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `audit_log`
--
ALTER TABLE `audit_log`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `authors`
--
ALTER TABLE `authors`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_authors_name` (`name`);

--
-- Indexes for table `books`
--
ALTER TABLE `books`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_books_author` (`author_id`);
ALTER TABLE `books` ADD FULLTEXT KEY `ft_books_title` (`title`);

--
-- Indexes for table `type_zoo`
--
ALTER TABLE `type_zoo`
  ADD PRIMARY KEY (`id`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `audit_log`
--
ALTER TABLE `audit_log`
  MODIFY `id` int unsigned NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `authors`
--
ALTER TABLE `authors`
  MODIFY `id` int unsigned NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=4;

--
-- AUTO_INCREMENT for table `books`
--
ALTER TABLE `books`
  MODIFY `id` int unsigned NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=5;

--
-- AUTO_INCREMENT for table `type_zoo`
--
ALTER TABLE `type_zoo`
  MODIFY `id` int NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=3;

-- --------------------------------------------------------

--
-- Structure for view `v_book_authors`
--
DROP TABLE IF EXISTS `v_book_authors`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`localhost` SQL SECURITY DEFINER VIEW `v_book_authors`  AS SELECT `b`.`id` AS `book_id`,`b`.`title` AS `title`,`a`.`name` AS `author` FROM (`books` `b` JOIN `authors` `a` ON((`a`.`id` = `b`.`author_id`)));

--
-- Constraints for dumped tables
--

--
-- Constraints for table `books`
--
ALTER TABLE `books`
  ADD CONSTRAINT `fk_books_author` FOREIGN KEY (`author_id`) REFERENCES `authors` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

DELIMITER $$
--
-- Events
--
CREATE DEFINER=`root`@`localhost` EVENT `ev_cleanup_audit_log` ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00' ON COMPLETION NOT PRESERVE DISABLE COMMENT 'Purge old audit rows' DO DELETE FROM `audit_log` WHERE `created_at` < NOW() - INTERVAL 30 DAY$$

DELIMITER ;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

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
-- Database: `tmp_zoo`
--

DELIMITER $$
--
-- Procedures
--
CREATE DEFINER=`root`@`%` PROCEDURE `sp_children`(IN p_parent INT)
BEGIN
  SELECT * FROM `child` WHERE `parent_id` = p_parent ORDER BY `id`;
END$$

--
-- Functions
--
CREATE DEFINER=`root`@`%` FUNCTION `fn_count`(p_parent INT) RETURNS int(11)
    READS SQL DATA
    DETERMINISTIC
BEGIN
  DECLARE n INT;
  SELECT COUNT(*) INTO n FROM `child` WHERE `parent_id` = p_parent;
  RETURN n;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `audit`
--

CREATE TABLE `audit` (
  `id` int(11) NOT NULL,
  `msg` varchar(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

-- --------------------------------------------------------

--
-- Table structure for table `child`
--

CREATE TABLE `child` (
  `id` int(11) NOT NULL,
  `parent_id` int(11) NOT NULL,
  `note` text DEFAULT NULL,
  `data` blob DEFAULT NULL,
  `bits` bit(8) DEFAULT NULL,
  `geo` geometry DEFAULT NULL,
  `doc` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`doc`)),
  `amount` decimal(10,2) DEFAULT NULL,
  `ratio` double DEFAULT NULL,
  `created` timestamp NOT NULL DEFAULT '<DATETIME>',
  `flags` set('x','y','z') DEFAULT NULL,
  `bin` varbinary(16) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;

--
-- Dumping data for table `child`
--

INSERT INTO `child` (`id`, `parent_id`, `note`, `data`, `bits`, `geo`, `doc`, `amount`, `ratio`, `created`, `flags`, `bin`) VALUES
(1, 1, 'line1\nline2	tab', 0x00ff10, b'10101010', 0x000000000101000000000000000000f03f0000000000000040, '{\"k\": [1, 2, {\"n\": null}]}', 12.50, 0.1, '<DATETIME>', 'x,z', 0x0a),
(2, 2, NULL, '', NULL, NULL, NULL, NULL, 0.0000001, '2024-03-01 00:00:00', NULL, NULL),
(7, 5, '0', 0x30, b'00000001', 0x00000000010100000000000000000008400000000000001040, 'null', -0.01, 123456789.123456, '<DATETIME>', 'y', '');

--
-- Triggers `child`
--
DELIMITER $$
CREATE TRIGGER `trg_child_ai` AFTER INSERT ON `child` FOR EACH ROW BEGIN
  INSERT INTO `audit` (`msg`) VALUES (CONCAT('child: ', NEW.`id`));
END
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `parent`
--

CREATE TABLE `parent` (
  `id` int(11) NOT NULL,
  `name` varchar(50) NOT NULL COMMENT 'The "name" of it',
  `kind` enum('a','b','c') NOT NULL DEFAULT 'a'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci COMMENT='Parents';

--
-- Dumping data for table `parent`
--

INSERT INTO `parent` (`id`, `name`, `kind`) VALUES
(1, 'O\'Brien \"quoted\" \\ back', 'b'),
(2, 'Zoë émoji 😀', 'c'),
(5, 'plain', 'a');

-- --------------------------------------------------------

--
-- Stand-in structure for view `v_child`
-- (See below for the actual view)
--
CREATE TABLE `v_child` (
`child_id` int(11)
,`parent_name` varchar(50)
,`n` bigint(21)
);

--
-- Indexes for dumped tables
--

--
-- Indexes for table `audit`
--
ALTER TABLE `audit`
  ADD PRIMARY KEY (`id`);

--
-- Indexes for table `child`
--
ALTER TABLE `child`
  ADD PRIMARY KEY (`id`),
  ADD KEY `idx_parent` (`parent_id`);
ALTER TABLE `child` ADD FULLTEXT KEY `ft_note` (`note`);

--
-- Indexes for table `parent`
--
ALTER TABLE `parent`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `uq_name` (`name`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `audit`
--
ALTER TABLE `audit`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- AUTO_INCREMENT for table `child`
--
ALTER TABLE `child`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=8;

--
-- AUTO_INCREMENT for table `parent`
--
ALTER TABLE `parent`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT, AUTO_INCREMENT=6;

-- --------------------------------------------------------

--
-- Structure for view `v_child`
--
DROP TABLE IF EXISTS `v_child`;

CREATE ALGORITHM=UNDEFINED DEFINER=`root`@`%` SQL SECURITY DEFINER VIEW `v_child`  AS SELECT `c`.`id` AS `child_id`,`p`.`name` AS `parent_name`,count(0) AS `n` FROM (`child` `c` JOIN `parent` `p` ON(`p`.`id` = `c`.`parent_id`)) WHERE `c`.`note` <> 'x and y from where' GROUP BY `c`.`id`,`p`.`name`;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `child`
--
ALTER TABLE `child`
  ADD CONSTRAINT `fk_child_parent` FOREIGN KEY (`parent_id`) REFERENCES `parent` (`id`) ON DELETE CASCADE;

DELIMITER $$
--
-- Events
--
CREATE DEFINER=`root`@`%` EVENT `ev_cleanup` ON SCHEDULE EVERY 1 DAY STARTS '2030-01-01 00:00:00' ON COMPLETION NOT PRESERVE DISABLE COMMENT 'Purge' DO DELETE FROM `audit` WHERE `id` < 0$$

DELIMITER ;
COMMIT;

/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;

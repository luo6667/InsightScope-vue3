package data

import "gorm.io/gorm"

// BumpDataVersion runs in the same MySQL transaction as a comment write.
func BumpDataVersion(tx *gorm.DB, datasetID string) error {
	return tx.Exec("INSERT INTO dataset_versions (datasetId, version) VALUES (?, 1) ON DUPLICATE KEY UPDATE version = version + 1", datasetID).Error
}

func CurrentDataVersion(db *gorm.DB, datasetID string) (uint64, error) {
	var version uint64
	err := db.Raw("SELECT version FROM dataset_versions WHERE datasetId = ?", datasetID).Scan(&version).Error
	return version, err
}

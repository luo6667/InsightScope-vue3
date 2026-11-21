package analysis

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strconv"
)

type AIConfig struct {
	APIKey      string  `json:"apiKey"`
	BaseURL     string  `json:"baseUrl"`
	Model       string  `json:"model"`
	Temperature float64 `json:"temperature"`
}

type Credentials struct{ AEAD cipher.AEAD }

func NewCredentials(encodedKey string) (Credentials, error) {
	if encodedKey == "" {
		return Credentials{}, errors.New("未设置 ANALYSIS_ENCRYPTION_KEY；请在启动 API 和 Worker 的终端设置相同的密钥")
	}
	key, err := base64.StdEncoding.DecodeString(encodedKey)
	if err != nil || len(key) != 32 {
		return Credentials{}, errors.New("ANALYSIS_ENCRYPTION_KEY 必须是 32 字节密钥的 Base64 编码")
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return Credentials{}, err
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return Credentials{}, err
	}
	return Credentials{AEAD: aead}, nil
}

func (c Credentials) Encrypt(jobID uint64, config AIConfig) (nonce, ciphertext []byte, err error) {
	plaintext, err := json.Marshal(config)
	if err != nil {
		return nil, nil, err
	}
	nonce = make([]byte, c.AEAD.NonceSize())
	if _, err = rand.Read(nonce); err != nil {
		return nil, nil, err
	}
	ciphertext = c.AEAD.Seal(nil, nonce, plaintext, []byte(strconv.FormatUint(jobID, 10)))
	return nonce, ciphertext, nil
}

func (c Credentials) Decrypt(jobID uint64, nonce, ciphertext []byte) (AIConfig, error) {
	plaintext, err := c.AEAD.Open(nil, nonce, ciphertext, []byte(strconv.FormatUint(jobID, 10)))
	if err != nil {
		return AIConfig{}, errors.New("分析任务凭据解密失败")
	}
	var config AIConfig
	if err := json.Unmarshal(plaintext, &config); err != nil {
		return AIConfig{}, errors.New("分析任务凭据格式无效")
	}
	return config, nil
}

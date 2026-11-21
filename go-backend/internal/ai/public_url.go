package ai

import (
	"context"
	"errors"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"time"
)

var invalidAddress = errors.New("baseUrl不允许访问本地/内网地址")

func PublicBaseURL(raw string) (string, error) {
	base := strings.TrimRight(strings.TrimSpace(raw), "/")
	if base == "" {
		return "", errors.New("baseUrl不能为空")
	}
	u, err := url.Parse(base)
	if err != nil || u.Hostname() == "" {
		return "", errors.New("baseUrl格式无效")
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return "", errors.New("baseUrl仅支持 http/https")
	}
	if u.User != nil {
		return "", errors.New("baseUrl不允许包含用户名/密码")
	}
	host := strings.ToLower(u.Hostname())
	if host == "localhost" || strings.HasSuffix(host, ".localhost") || strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return "", invalidAddress
	}
	if ip, err := netip.ParseAddr(host); err == nil && !publicIP(ip) {
		return "", invalidAddress
	}
	return base, nil
}

func publicIP(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsValid() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
		return false
	}
	for _, rangeText := range []string{"100.64.0.0/10", "192.0.0.0/24", "192.0.2.0/24", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"} {
		if netip.MustParsePrefix(rangeText).Contains(ip) {
			return false
		}
	}
	return true
}

// Dial-time validation prevents a public-looking hostname from resolving to a private address.
func NewPublicClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = nil
	transport.DialContext = func(ctx context.Context, network, address string) (net.Conn, error) {
		host, port, err := net.SplitHostPort(address)
		if err != nil {
			return nil, err
		}
		ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
		if err != nil {
			return nil, err
		}
		for _, ip := range ips {
			if !publicIP(ip) {
				return nil, invalidAddress
			}
		}
		if len(ips) == 0 {
			return nil, errors.New("no address")
		}
		return (&net.Dialer{Timeout: 15 * time.Second}).DialContext(ctx, network, net.JoinHostPort(ips[0].String(), port))
	}
	return &http.Client{Transport: transport, CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
}

package analysis

import (
	"regexp"
	"sort"
	"strings"
	"unicode/utf8"
)

// The order matches the Node textService dictionary; extraction preserves first occurrence order.
var dictionary = []string{
	"满意", "好用", "不错", "挺好", "很好", "好评", "推荐", "喜欢", "划算", "实惠", "流畅", "稳定", "给力", "值得", "优秀", "惊喜", "靠谱", "舒服", "完美", "耐用", "质量好", "物美价廉",
	"一般", "还行", "观望", "中规中矩", "更新", "反馈", "客服", "物流", "快递", "价格", "性价比", "质量", "性能", "售后", "发货", "版本", "功能", "包装", "续航", "外观",
	"太差", "很差", "差劲", "垃圾", "失望", "卡顿", "闪退", "耗电", "太慢", "很慢", "坑", "难用", "投诉", "退款", "维修", "故障", "糟糕", "无语", "后悔", "差评", "虚假", "欺骗", "维权", "太贵", "不值", "退货", "瑕疵", "破损", "漏发", "拖延", "踢皮球",
}

var stopWords = map[string]bool{
	"这个": true, "那个": true, "我们": true, "你们": true, "他们": true, "一个": true, "可以": true, "就是": true, "但是": true, "还是": true, "因为": true, "所以": true, "怎么": true, "什么": true, "没有": true, "非常": true, "真的": true, "感觉": true, "一下": true, "有点": true, "已经": true, "比较": true, "然后": true, "而且": true, "如果": true, "应该": true, "希望": true, "不过": true, "现在": true, "觉得": true, "时候": true, "问题": true, "东西": true, "地方": true, "这样": true, "那样": true, "多少": true, "为什么": true,
}

var englishWord = regexp.MustCompile(`[a-zA-Z][a-zA-Z0-9_-]{1,}`)

func extractKeywords(content string, limit int, custom []string) []string {
	seen := make(map[string]bool)
	words := make([]string, 0)
	add := func(word string) {
		if !seen[word] {
			seen[word] = true
			words = append(words, word)
		}
	}
	for _, word := range englishWord.FindAllString(content, -1) {
		add(strings.ToLower(word))
	}
	for _, word := range dictionary {
		if strings.Contains(content, word) {
			add(word)
		}
	}
	for _, word := range custom {
		word = strings.TrimSpace(word)
		if word != "" && strings.Contains(content, word) {
			add(word)
		}
	}
	result := make([]string, 0, limit)
	for _, word := range words {
		// JavaScript's string.length counts UTF-16 code units; dictionary entries are BMP characters.
		if !stopWords[word] && utf8.RuneCountInString(word) <= 12 {
			result = append(result, word)
			if len(result) == limit {
				break
			}
		}
	}
	return result
}

type KeywordCount struct {
	Word  string `json:"word"`
	Count int    `json:"count"`
}

func CountKeywords(contents []string, limit int, custom []string) []KeywordCount {
	freq := make(map[string]int)
	order := make(map[string]int)
	for _, content := range contents {
		for _, word := range extractKeywords(content, 12, custom) {
			if _, ok := freq[word]; !ok {
				order[word] = len(order)
			}
			freq[word]++
		}
	}
	result := make([]KeywordCount, 0, len(freq))
	for word, count := range freq {
		result = append(result, KeywordCount{Word: word, Count: count})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Count == result[j].Count {
			return order[result[i].Word] < order[result[j].Word]
		}
		return result[i].Count > result[j].Count
	})
	if len(result) > limit {
		result = result[:limit]
	}
	return result
}

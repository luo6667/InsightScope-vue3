package analysis

import "testing"

func TestCountKeywordsPreservesDictionaryAndCustomWords(t *testing.T) {
	got := CountKeywords([]string{"闪退 闪退 app体验", "闪退 卡顿 app体验"}, 20, []string{"app体验"})
	if len(got) < 3 || got[0].Word != "app" || got[0].Count != 2 || got[1].Word != "闪退" || got[1].Count != 2 || got[2].Word != "app体验" || got[2].Count != 2 {
		t.Fatalf("keywords = %#v", got)
	}
}

func TestCountKeywordsEmptyIsArray(t *testing.T) {
	if got := CountKeywords(nil, 20, nil); got == nil || len(got) != 0 {
		t.Fatalf("keywords = %#v", got)
	}
}

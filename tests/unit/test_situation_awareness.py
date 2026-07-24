from backend.workflow.situation_awareness import execute_situation_awareness


def test_recent_window_classifies_dedupes_and_reports_platforms():
    report = execute_situation_awareness(
        [
            {
                "raw": {
                    "title": "AI 新模型 #人工智能",
                    "url": "https://www.douyin.com/video/1?share_source=copy",
                    "create_time": 1784512800,
                    "digg_count": "2万",
                },
                "normalizedData": {
                    "title": "AI 新模型 #人工智能",
                    "url": "https://www.douyin.com/video/1?share_source=copy",
                    "source_id": "douyin",
                    "extra_create_time": 1784512800,
                },
            },
            {
                "title": "AI 新模型重复",
                "url": "https://www.douyin.com/video/1?utm_source=test",
                "source_id": "douyin",
                "published_at": "2026-07-20T02:00:00Z",
                "likes": 2,
            },
            {
                "title": "B站未知时间",
                "url": "https://www.bilibili.com/video/BV1",
                "source_id": "bilibili",
            },
            {
                "title": "过期内容",
                "url": "https://www.xiaohongshu.com/explore/old",
                "source_id": "xiaohongshu",
                "published_at": "2026-05-01T00:00:00Z",
            },
        ],
        {
            "query": "人工智能",
            "now": "2026-07-21T00:00:00Z",
            "windowDays": 30,
            "includeUnknownDates": True,
        },
    )

    assert report["schema"] == "situation.report.v1"
    assert report["counts"] == {
        "input": 4,
        "recent": 2,
        "unknownDate": 1,
        "baseline": 0,
        "older": 1,
        "future": 0,
        "includedAfterDedupe": 2,
        "duplicatesRemoved": 1,
    }
    assert {row["platform"] for row in report["platforms"]} == {"douyin", "bilibili"}
    assert report["topItems"][0]["url"] == "https://www.douyin.com/video/1"
    assert report["topItems"][0]["engagementScore"] == 20000
    assert report["topics"][0]["label"] == "人工智能"
    assert "近 30 天事态感知" in report["brief"]


def test_baseline_and_velocity_emit_traceable_signals():
    report = execute_situation_awareness(
        [
            {
                "title": "今天一",
                "source_id": "twitter",
                "created_at": "2026-07-20T12:00:00Z",
            },
            {
                "title": "今天二",
                "source_id": "twitter",
                "created_at": "2026-07-20T13:00:00Z",
            },
            {
                "title": "基线",
                "source_id": "twitter",
                "created_at": "2026-06-10T12:00:00Z",
            },
        ],
        {
            "now": "2026-07-21T00:00:00Z",
            "windowDays": 30,
            "baselineDays": 30,
            "includeUnknownDates": False,
        },
    )

    signal_types = {signal["type"] for signal in report["signals"]}
    assert "velocity_spike" in signal_types
    assert "window_momentum" in signal_types
    assert "platform_concentration" in signal_types
    assert report["counts"]["baseline"] == 1


def test_future_items_are_not_included():
    report = execute_situation_awareness(
        [{"title": "未来", "source_id": "douyin", "create_time": 1893456000}],
        {"now": "2026-07-21T00:00:00Z"},
    )

    assert report["counts"]["future"] == 1
    assert report["counts"]["includedAfterDedupe"] == 0

"""
Tests for ESPN highlights feed normalization.

These stay network-free and validate the two ESPN shapes we rely on:
direct clip endpoints and article endpoints with attached video.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_normalize_direct_clip_payload():
    from routers.sports import _normalize_espn_highlight_item

    article = {
        "id": 1001,
        "headline": "Top NHL play of the night",
        "description": "A late dagger wins it.",
        "league": "NHL",
        "published": "2026-03-22T04:58:13Z",
        "categories": [
            {"type": "team", "description": "Boston Bruins"},
            {"type": "team", "description": "Detroit Red Wings"},
            {"type": "event", "eventId": 401999001},
        ],
        "links": {
            "web": {"href": "https://www.espn.com/nhl/story/_/id/1001/story"},
        },
    }
    detail = {
        "videos": [
            {
                "id": 48280001,
                "headline": "Top NHL play of the night",
                "description": "A late dagger wins it.",
                "duration": 57,
                "originalPublishDate": "2026-03-22T04:58:13Z",
                "videoRatio": "16:9,9:16",
                "thumbnail": "https://cdn.example.com/thumb.jpg",
                "posterImages": {
                    "vertical": {"href": "https://cdn.example.com/vertical.jpg"},
                    "wide": {"href": "https://cdn.example.com/wide.jpg"},
                    "square": {"href": "https://cdn.example.com/square.jpg"},
                },
                "links": {
                    "web": {"href": "https://www.espn.com/video/clip?id=48280001"},
                    "source": {
                        "full": {"href": "https://cdn.example.com/clip.mp4"},
                        "HLS": {"href": "https://cdn.example.com/playlist.m3u8"},
                    },
                },
                "gameId": 401999001,
            }
        ]
    }

    item = _normalize_espn_highlight_item("NHL", article, detail)

    assert item is not None
    assert item["id"] == "48280001"
    assert item["league"] == "NHL"
    assert item["videoUrl"] == "https://cdn.example.com/clip.mp4"
    assert item["hlsUrl"] == "https://cdn.example.com/playlist.m3u8"
    assert item["verticalPosterUrl"] == "https://cdn.example.com/vertical.jpg"
    assert item["durationLabel"] == "0:57"
    assert item["teamTags"] == ["Boston Bruins", "Detroit Red Wings"]
    assert item["eventId"] == "401999001"
    assert item["contentFormat"] == "VIDEO"
    assert isinstance(item["popularityScore"], (int, float))


def test_normalize_article_with_attached_video():
    from routers.sports import _normalize_espn_highlight_item

    article = {
        "id": 1002,
        "headline": "Buzzer-beaters and milestones highlight Saturday's top plays in the NBA",
        "description": "Every big bucket from Saturday night.",
        "league": "NBA",
        "published": "2026-03-22T05:00:27Z",
        "categories": [
            {"type": "team", "description": "Los Angeles Lakers"},
            {"type": "team", "description": "Orlando Magic"},
        ],
        "links": {
            "web": {"href": "https://www.espn.com/nba/story/_/id/1002/top-plays"},
        },
    }
    detail = {
        "headlines": [
            {
                "video": [
                    {
                        "id": 48280002,
                        "headline": "Saturday's top NBA plays",
                        "description": "Every big bucket from Saturday night.",
                        "duration": 125,
                        "originalPublishDate": "2026-03-22T05:00:27Z",
                        "posterImages": {
                            "default": {"href": "https://cdn.example.com/default.jpg"},
                            "wide": {"href": "https://cdn.example.com/wide-2.jpg"},
                        },
                        "links": {
                            "web": {"href": "https://www.espn.com/video/clip?id=48280002"},
                            "source": {
                                "HD": {"href": "https://cdn.example.com/hd.mp4"},
                            },
                            "mobile": {
                                "source": {"href": "https://cdn.example.com/mobile.mp4"},
                            },
                        },
                    }
                ]
            }
        ]
    }

    item = _normalize_espn_highlight_item("NBA", article, detail)

    assert item is not None
    assert item["id"] == "48280002"
    assert item["league"] == "NBA"
    assert item["typeLabel"] == "Top Plays"
    assert item["videoUrl"] == "https://cdn.example.com/hd.mp4"
    assert item["posterUrl"] == "https://cdn.example.com/default.jpg"
    assert item["widePosterUrl"] == "https://cdn.example.com/wide-2.jpg"
    assert item["storyUrl"] == "https://www.espn.com/nba/story/_/id/1002/top-plays"
    assert item["durationLabel"] == "2:05"
    assert item["contentFormat"] == "VIDEO"
    assert isinstance(item["popularityScore"], (int, float))


def test_normalize_hls_only_clip_payload():
    from routers.sports import _normalize_espn_highlight_item

    article = {
        "id": 1003,
        "headline": "Late winner in the EPL",
        "description": "A stoppage-time goal seals it.",
        "league": "EPL",
        "published": "2026-03-22T05:05:00Z",
        "categories": [
            {"type": "team", "description": "Everton"},
            {"type": "team", "description": "Chelsea"},
        ],
    }
    detail = {
        "videos": [
            {
                "id": 48280003,
                "headline": "Late winner in the EPL",
                "description": "A stoppage-time goal seals it.",
                "duration": 42,
                "originalPublishDate": "2026-03-22T05:05:00Z",
                "videoRatio": "9:16",
                "posterImages": {
                    "default": {"href": "https://cdn.example.com/epl-default.jpg"},
                    "vertical": {"href": "https://cdn.example.com/epl-vertical.jpg"},
                },
                "links": {
                    "web": {"href": "https://www.espn.com/video/clip?id=48280003"},
                    "source": {
                        "HLS": {"href": "https://cdn.example.com/epl-playlist.m3u8"},
                    },
                },
            }
        ]
    }

    item = _normalize_espn_highlight_item("EPL", article, detail)

    assert item is not None
    assert item["id"] == "48280003"
    assert item["league"] == "EPL"
    assert item["videoUrl"] is None
    assert item["hlsUrl"] == "https://cdn.example.com/epl-playlist.m3u8"
    assert item["durationLabel"] == "0:42"
    assert item["contentFormat"] == "REEL"
    assert isinstance(item["popularityScore"], (int, float))


def test_normalize_mlb_highlight_item():
    from routers.sports import _normalize_mlb_highlight_item

    game = {
        "gamePk": 777001,
        "gameDate": "2026-03-22T01:10:00Z",
        "teams": {
            "away": {"team": {"name": "Chicago Cubs"}},
            "home": {"team": {"name": "St. Louis Cardinals"}},
        },
    }
    clip = {
        "id": "mlb-clip-01",
        "headline": "Walk-off winner for St. Louis",
        "description": "The Cardinals end it late.",
        "date": "2026-03-22T04:15:00Z",
        "duration": "00:01:12",
        "slug": "walk-off-winner-for-st-louis",
        "image": {
            "cuts": [
                {"src": "https://img.mlbstatic.com/wide.jpg", "width": 1280},
            ]
        },
        "playbacks": [
            {"name": "hlsCloud", "url": "https://mlb.example.com/clip.m3u8"},
            {"name": "mp4Avc", "url": "https://mlb.example.com/clip.mp4"},
        ],
    }

    item = _normalize_mlb_highlight_item(game, clip)

    assert item is not None
    assert item["id"] == "mlb-clip-01"
    assert item["league"] == "MLB"
    assert item["videoUrl"] == "https://mlb.example.com/clip.mp4"
    assert item["hlsUrl"] == "https://mlb.example.com/clip.m3u8"
    assert item["posterUrl"] == "https://img.mlbstatic.com/wide.jpg"
    assert item["pageUrl"] == "https://www.mlb.com/video/walk-off-winner-for-st-louis"
    assert item["teamTags"] == ["Chicago Cubs", "St. Louis Cardinals"]
    assert item["contentFormat"] == "VIDEO"


def test_normalize_scorebat_highlight_item():
    from routers.sports import _normalize_scorebat_highlight_item

    item = _normalize_scorebat_highlight_item(
        {
            "title": "Arsenal - Chelsea",
            "competition": "ENGLAND: Premier League",
            "date": "2026-03-22T05:22:00+0000",
            "thumbnail": "https://scorebat.example.com/thumb.jpg",
            "matchviewUrl": "https://www.scorebat.com/arsenal-chelsea-live-stream/",
            "competitionUrl": "https://www.scorebat.com/england-premier-league/",
            "videos": [
                {
                    "id": "scorebat-clip-01",
                    "title": "Highlights",
                    "embed": '<iframe src="https://www.scorebat.com/embed/v/scorebat-clip-01/?utm_source=api"></iframe>',
                }
            ],
        }
    )

    assert item is not None
    assert item["id"] == "scorebat-clip-01"
    assert item["league"] == "EPL"
    assert item["embedUrl"] == "https://www.scorebat.com/embed/v/scorebat-clip-01/?utm_source=api"
    assert item["posterUrl"] == "https://scorebat.example.com/thumb.jpg"
    assert item["pageUrl"] == "https://www.scorebat.com/arsenal-chelsea-live-stream/"
    assert item["storyUrl"] == "https://www.scorebat.com/england-premier-league/"
    assert item["teamTags"] == ["Arsenal", "Chelsea"]
    assert item["contentFormat"] == "VIDEO"


def test_highlight_dedupe_keys_catch_cross_provider_duplicates():
    from routers.sports import _build_highlight_dedupe_keys

    espn_item = {
        "id": "espn-1",
        "league": "NHL",
        "title": "Carolina Hurricanes vs. Pittsburgh Penguins: Game Highlights",
        "typeLabel": "Game Highlights",
        "eventId": "401000001",
        "durationSeconds": 77,
        "teamTags": ["Carolina Hurricanes", "Pittsburgh Penguins"],
        "videoUrl": "https://cdn.espn.com/clip.mp4?quality=720",
    }
    nhl_item = {
        "id": "nhl-1",
        "league": "NHL",
        "title": "Carolina Hurricanes vs Pittsburgh Penguins Highlights",
        "typeLabel": "Game Highlights",
        "eventId": "401000001",
        "durationSeconds": 79,
        "teamTags": ["Pittsburgh Penguins", "Carolina Hurricanes"],
        "embedUrl": "https://www.nhl.com/video/clip/401000001",
    }

    assert _build_highlight_dedupe_keys(espn_item) & _build_highlight_dedupe_keys(nhl_item)


def test_highlight_url_dedupe_key_strips_query_noise():
    from routers.sports import _normalize_highlight_url_key

    assert _normalize_highlight_url_key("https://www.scorebat.com/embed/v/clip-01/?utm_source=api") == "scorebat.com/embed/v/clip-01"


def test_noise_highlight_titles_are_filtered():
    from routers.sports import _is_noise_highlight_title

    assert _is_noise_highlight_title({"title": "Starting lineups for Dodgers at Angels - March 22, 2026"})
    assert _is_noise_highlight_title({"title": "Bench availability for Los Angeles, March 22 vs Angels"})
    assert _is_noise_highlight_title({"title": "Bullpen availability for Los Angeles, March 22 vs Angels"})
    assert not _is_noise_highlight_title({"title": "Kyle Manzardo mashes a home run for the Guardians"})


def test_espn_highlight_images_upgrade_to_higher_quality():
    from routers.sports import _normalize_espn_highlight_item

    article = {
        "id": 1004,
        "headline": "Big finish in Chicago",
        "description": "A clean late-game sequence.",
        "league": "NHL",
        "published": "2026-03-22T05:30:00Z",
        "categories": [
            {"type": "team", "description": "Nashville Predators"},
            {"type": "team", "description": "Chicago Blackhawks"},
        ],
    }
    detail = {
        "videos": [
            {
                "id": 48280004,
                "headline": "Big finish in Chicago",
                "description": "A clean late-game sequence.",
                "duration": 79,
                "originalPublishDate": "2026-03-22T05:30:00Z",
                "posterImages": {
                    "wide": {"href": "https://a.espncdn.com/i/video/123456/clip.jpg"},
                    "vertical": {"href": "https://a.espncdn.com/i/video/123456/vertical.jpg"},
                },
                "links": {
                    "source": {
                        "full": {"href": "https://cdn.example.com/highlights.mp4"},
                    },
                },
            }
        ]
    }

    item = _normalize_espn_highlight_item("NHL", article, detail)

    assert item is not None
    assert item["widePosterUrl"].startswith("/api/sports/highlights/image?src=")
    assert "w%3D1920" in item["widePosterUrl"]
    assert "h%3D1080" in item["widePosterUrl"]
    assert item["verticalPosterUrl"].startswith("/api/sports/highlights/image?src=")

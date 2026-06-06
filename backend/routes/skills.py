"""Externally callable skills API.

The first exposed skill is a read-only schedule query for agent callers such as
OpenClaw or Hermes. Installation/discovery assets are public, while invocation
uses the existing login/Bearer auth boundary.
"""
import datetime as dt

from flask import Blueprint, Response, jsonify, request, g

from auth import login_required
from db import db, rows_to_dicts
from routes.schedule import DATE_RE

bp = Blueprint("skills", __name__)


SCHEDULE_QUERY_SKILL = {
    "name": "schedule.query",
    "title": "Edu Course Schedule",
    "description": "Query the authenticated user's course schedule by date and optional child name.",
    "version": "1.0.0",
    "auth": {
        "type": "bearer",
        "header": "Authorization",
        "scheme": "Bearer",
        "env": "EDU_BEARER_TOKEN",
    },
    "input_schema": {
        "type": "object",
        "properties": {
            "date": {
                "type": "string",
                "format": "date",
                "description": "Date to query in YYYY-MM-DD format.",
            },
            "child": {
                "type": "string",
                "description": "Optional child name filter.",
            },
        },
        "required": ["date"],
        "additionalProperties": False,
    },
}


@bp.get("/api/skills")
def list_skills():
    skill = _skill_manifest()
    return jsonify({"skills": [skill]})


@bp.get("/.well-known/edu-skills.json")
def well_known_skills():
    return jsonify({
        "name": "edu.executor.life skills",
        "skills": [_skill_manifest()],
    })


@bp.get("/api/skills/<skill_name>/manifest.json")
def skill_manifest(skill_name):
    if skill_name != "schedule.query":
        return jsonify({"error": "skill_not_found"}), 404
    return jsonify(_skill_manifest())


@bp.get("/api/skills/<skill_name>/openapi.json")
def skill_openapi(skill_name):
    if skill_name != "schedule.query":
        return jsonify({"error": "skill_not_found"}), 404
    return jsonify(_schedule_query_openapi())


@bp.get("/api/skills/<skill_name>/SKILL.md")
def skill_markdown(skill_name):
    if skill_name != "schedule.query":
        return jsonify({"error": "skill_not_found"}), 404
    return Response(_schedule_query_skill_md(), mimetype="text/markdown; charset=utf-8")


@bp.post("/api/skills/<skill_name>/invoke")
@login_required
def invoke_skill(skill_name):
    if skill_name != "schedule.query":
        return jsonify({"error": "skill_not_found"}), 404
    return _invoke_schedule_query()


def _base_url() -> str:
    return request.url_root.rstrip("/")


def _skill_manifest() -> dict:
    base = _base_url()
    invoke_url = f"{base}/api/skills/schedule.query/invoke"
    skill_url = f"{base}/api/skills/schedule.query/SKILL.md"
    manifest_url = f"{base}/api/skills/schedule.query/manifest.json"
    openapi_url = f"{base}/api/skills/schedule.query/openapi.json"
    discovery_url = f"{base}/api/skills"

    skill = dict(SCHEDULE_QUERY_SKILL)
    skill["endpoints"] = {
        "discovery_url": discovery_url,
        "manifest_url": manifest_url,
        "skill_url": skill_url,
        "openapi_url": openapi_url,
        "invoke_url": invoke_url,
    }
    skill["install"] = {
        "agent_skill": {
            "format": "SKILL.md",
            "url": skill_url,
            "instructions": "Install or copy this SKILL.md into the agent skills directory, then set EDU_BEARER_TOKEN.",
        },
        "openclaw": {
            "url": skill_url,
            "requires_env": ["EDU_BEARER_TOKEN"],
        },
        "hermes": {
            "url": skill_url,
            "requires_env": ["EDU_BEARER_TOKEN"],
        },
    }
    return skill


def _schedule_query_openapi() -> dict:
    base = _base_url()
    return {
        "openapi": "3.1.0",
        "info": {
            "title": "Edu Course Schedule Skill",
            "version": SCHEDULE_QUERY_SKILL["version"],
            "description": SCHEDULE_QUERY_SKILL["description"],
        },
        "servers": [{"url": base}],
        "components": {
            "securitySchemes": {
                "bearerAuth": {
                    "type": "http",
                    "scheme": "bearer",
                    "bearerFormat": "edu-mobile-token",
                },
            },
        },
        "paths": {
            "/api/skills/schedule.query/invoke": {
                "post": {
                    "operationId": "schedule.query",
                    "summary": "Query course schedule by date and optional child name.",
                    "security": [{"bearerAuth": []}],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": SCHEDULE_QUERY_SKILL["input_schema"],
                            },
                        },
                    },
                    "responses": {
                        "200": {
                            "description": "Schedule query result.",
                        },
                        "400": {"description": "Invalid input."},
                        "401": {"description": "Missing or invalid bearer token."},
                    },
                },
            },
        },
    }


def _schedule_query_skill_md() -> str:
    base = _base_url()
    invoke_url = f"{base}/api/skills/schedule.query/invoke"
    manifest_url = f"{base}/api/skills/schedule.query/manifest.json"
    openapi_url = f"{base}/api/skills/schedule.query/openapi.json"
    return f"""---
name: edu-course-schedule
description: Query the edu.executor.life course schedule by date and optional child name. Requires EDU_BEARER_TOKEN.
homepage: {manifest_url}
metadata: {{"openclaw": {{"requires": {{"env": ["EDU_BEARER_TOKEN"]}}, "primaryEnv": "EDU_BEARER_TOKEN", "emoji": "calendar"}}}}
---

# Edu Course Schedule

Use this skill when a user asks about the family course schedule, today's classes,
tomorrow's classes, or a specific child's courses.

## Configuration

Set `EDU_BEARER_TOKEN` to a valid bearer token from edu.executor.life. The
schedule contains private child data, so this skill must not be called without
authorization.

## API

- Manifest: `{manifest_url}`
- OpenAPI: `{openapi_url}`
- Invoke: `{invoke_url}`

Request JSON:

```json
{{"date":"YYYY-MM-DD","child":"optional child name"}}
```

The `child` field is optional. Omit it to return every course visible to the
authenticated account for that date.

## Example

```bash
curl -sS -X POST "{invoke_url}" \\
  -H "Authorization: Bearer $EDU_BEARER_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{{"date":"2026-06-07","child":"潘立言"}}'
```

Use the response `result.courses` as the source of truth. If the API returns
`401`, ask the user to provide or refresh `EDU_BEARER_TOKEN`.
"""


def _invoke_schedule_query():
    body = request.get_json(silent=True) or {}
    date_text = (body.get("date") or "").strip()
    child = (body.get("child") or "").strip() or None

    if not DATE_RE.match(date_text):
        return jsonify({"error": "invalid_date"}), 400

    try:
        query_date = dt.date.fromisoformat(date_text)
    except ValueError:
        return jsonify({"error": "invalid_date"}), 400

    weekday = query_date.isoweekday()
    sql = (
        "SELECT * FROM courses WHERE owner_user_id = ? AND ("
        "  specific_date = ? OR (specific_date IS NULL AND weekday = ?)"
        ")"
    )
    args = [g.owner_id, date_text, weekday]
    if child:
        sql += " AND child_name = ?"
        args.append(child)
    sql += " ORDER BY start_time ASC, sort_order ASC, id ASC"

    with db() as conn:
        rows = conn.execute(sql, args).fetchall()

    return jsonify({
        "ok": True,
        "skill": "schedule.query",
        "result": {
            "date": date_text,
            "weekday": weekday,
            "child": child,
            "courses": rows_to_dicts(rows),
        },
    })

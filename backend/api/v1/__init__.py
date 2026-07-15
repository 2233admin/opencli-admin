"""API v1 router package."""

from fastapi import APIRouter

from backend.api.v1 import (
    agents,
    browser_act,
    browsers,
    chat,
    control,
    cookies,
    dashboard,
    geo_acquisition,
    model_defaults,
    nodes,
    notifications,
    plan_ir,
    plans,
    presets,
    providers,
    records,
    schedules,
    skill_bridge,
    skill_record,
    skills,
    sources,
    studio,
    system,
    tasks,
    webhooks,
    workers,
    workflows,
)

v1_router = APIRouter(prefix="/api/v1")

v1_router.include_router(agents.router)
v1_router.include_router(geo_acquisition.router)
v1_router.include_router(browser_act.router)
v1_router.include_router(browsers.router)
v1_router.include_router(chat.router)
v1_router.include_router(control.router)
v1_router.include_router(cookies.router)
v1_router.include_router(model_defaults.router)
v1_router.include_router(nodes.router)
v1_router.include_router(plan_ir.router)
v1_router.include_router(plans.router)
v1_router.include_router(presets.router)
v1_router.include_router(providers.router)
v1_router.include_router(sources.router)
v1_router.include_router(studio.router)
v1_router.include_router(tasks.router)
v1_router.include_router(records.router)
v1_router.include_router(schedules.router)
v1_router.include_router(skills.router)
v1_router.include_router(skill_bridge.router)
v1_router.include_router(skill_record.router)
v1_router.include_router(webhooks.router)
v1_router.include_router(workflows.router)
v1_router.include_router(notifications.router)
v1_router.include_router(workers.router)
v1_router.include_router(dashboard.router)
v1_router.include_router(system.router)

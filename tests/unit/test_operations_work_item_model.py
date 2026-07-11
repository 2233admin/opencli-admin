import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from backend.database import Base
from backend.models.operations_work_item import OperationsWorkItem, WorkItemStatus, WorkItemType


@pytest.mark.asyncio
async def test_operations_work_item_defaults_and_linkage() -> None:
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)

    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as session:
        proposal = OperationsWorkItem(workspace_id="workspace-1", type=WorkItemType.CHANGE_PROPOSAL)
        session.add(proposal)
        await session.flush()
        approval = OperationsWorkItem(
            workspace_id="workspace-1",
            type=WorkItemType.APPROVAL,
            parent_id=proposal.id,
            proposal_id=proposal.id,
            evidence={"diff": "plan v1 -> v2"},
            reason="risk policy requires approval",
        )
        session.add(approval)
        await session.commit()

        stored = await session.scalar(
            select(OperationsWorkItem).where(OperationsWorkItem.id == approval.id)
        )
        assert stored is not None
        assert stored.status == WorkItemStatus.OPEN
        assert stored.severity == "low"
        assert stored.priority == "normal"
        assert stored.parent_id == proposal.id == stored.proposal_id
        assert stored.evidence == {"diff": "plan v1 -> v2"}

    await engine.dispose()

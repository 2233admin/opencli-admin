from abc import ABC, abstractmethod


class AbstractExecutor(ABC):
    @abstractmethod
    async def dispatch_acquisition(self, execution_id: str) -> None: ...

    @abstractmethod
    async def cancel_acquisition(self, execution_id: str) -> None: ...

    @abstractmethod
    async def dispatch_collection(self, task_id: str, parameters: dict) -> dict: ...

    @abstractmethod
    async def dispatch_scheduled_collection(
        self, schedule_id: str, source_id: str, parameters: dict
    ) -> None: ...

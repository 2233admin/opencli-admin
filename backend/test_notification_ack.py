from backend.pipeline.notifier_dispatch import _ack_secret


def test_ack_requires_explicit_secret() -> None:
    assert _ack_secret({"secret": "delivery-signing-secret"}) == ""
    assert _ack_secret({"ack_secret": "ack-signing-secret"}) == "ack-signing-secret"

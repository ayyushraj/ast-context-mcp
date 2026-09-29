from typing import Optional


class Order:
    def __init__(self, order_id: str, amount: float) -> None:
        self.order_id = order_id
        self.amount = amount


def make_order(order_id: str, amount: float) -> Order:
    order = Order(order_id, amount)
    log_order(order)
    return order


def log_order(order: Order) -> None:
    print(f"order {order.order_id}: {order.amount}")


def find_order(order_id: str) -> Optional[Order]:
    return None


def main() -> None:
    make_order("o1", 42.0)

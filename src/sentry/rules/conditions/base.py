import abc

from sentry.rules.base import RuleBase


class EventCondition(RuleBase, abc.ABC):
    rule_type = "condition/event"

    def passes(self, event, state):
        raise NotImplementedError

import abc

from sentry.rules.base import RuleBase


class EventFilter(RuleBase, abc.ABC):
    rule_type = "filter/event"

    def passes(self, event, state):
        raise NotImplementedError

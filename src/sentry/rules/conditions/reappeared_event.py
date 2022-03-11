from sentry.rules.conditions.base import EventCondition


class ReappearedEventCondition(EventCondition):
    id = "sentry.rules.conditions.reappeared_event.ReappearedEventCondition"
    label = "The issue changes state from ignored to unresolved"

    def passes(self, event, state):
        return state.has_reappeared

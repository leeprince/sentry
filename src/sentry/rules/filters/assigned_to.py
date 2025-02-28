from __future__ import annotations

from typing import TYPE_CHECKING, Sequence

from django import forms

from sentry.eventstore.models import Event
from sentry.mail.forms.assigned_to import AssignedToForm
from sentry.notifications.types import ASSIGNEE_CHOICES, AssigneeTargetType
from sentry.rules import EventState
from sentry.rules.filters.base import EventFilter
from sentry.utils.cache import cache

if TYPE_CHECKING:
    from sentry.models import Group, Team, User


class AssignedToFilter(EventFilter):
    form_cls = AssignedToForm
    label = "The issue is assigned to {targetType}"
    prompt = "The issue is assigned to {no one/team/member}"

    form_fields = {"targetType": {"type": "assignee", "choices": ASSIGNEE_CHOICES}}

    def get_assignees(self, group: Group) -> Sequence[Team | User]:
        cache_key = f"group:{group.id}:assignees"
        assignee_list: Sequence[Team | User] | None = cache.get(cache_key)
        if assignee_list is None:
            assignee_list = list(group.assignee_set.all())
            cache.set(cache_key, assignee_list, 60)
        return assignee_list

    def passes(self, event: Event, state: EventState) -> bool:
        target_type = AssigneeTargetType(self.get_option("targetType"))

        if target_type == AssigneeTargetType.UNASSIGNED:
            return len(self.get_assignees(event.group)) == 0
        else:
            target_id = self.get_option("targetIdentifier", None)

            if target_type == AssigneeTargetType.TEAM:
                for assignee in self.get_assignees(event.group):
                    if assignee.team and assignee.team_id == target_id:
                        return True
            elif target_type == AssigneeTargetType.MEMBER:
                for assignee in self.get_assignees(event.group):
                    if assignee.user and assignee.user_id == target_id:
                        return True
            return False

    def get_form_instance(self) -> forms.Form:
        form: forms.Form = self.form_cls(self.project, self.data)
        return form

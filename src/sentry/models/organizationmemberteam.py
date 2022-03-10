from typing import FrozenSet

from django.db import models

from sentry import features, roles
from sentry.db.models import BaseModel, BoundedAutoField, FlexibleForeignKey, sane_repr
from sentry.roles import team_roles
from sentry.roles.manager import TeamRole


class OrganizationMemberTeam(BaseModel):
    """
    Identifies relationships between organization members and the teams they are on.
    """

    __include_in_export__ = True

    id = BoundedAutoField(primary_key=True)
    team = FlexibleForeignKey("sentry.Team")
    organizationmember = FlexibleForeignKey("sentry.OrganizationMember")
    # an inactive membership simply removes the team from the default list
    # but still allows them to re-join without request
    is_active = models.BooleanField(default=True)
    role = models.CharField(max_length=32, null=True, blank=True)

    class Meta:
        app_label = "sentry"
        db_table = "sentry_organizationmember_teams"
        unique_together = (("team", "organizationmember"),)

    __repr__ = sane_repr("team_id", "organizationmember_id")

    def get_audit_log_data(self):
        return {
            "team_slug": self.team.slug,
            "member_id": self.organizationmember_id,
            "email": self.organizationmember.get_email(),
            "is_active": self.is_active,
        }

    def get_team_role(self) -> TeamRole:
        """Get this member's team-level role.

        This is guaranteed to resolve to a non-null role object. If the role field is
        null, resolve the member's organization-level role to its team entry role.
        """
        entry_role = roles.get_entry_role(self.organizationmember.role)
        if self.role:
            team_role = team_roles.get(self.role)
            if team_role.priority > entry_role.priority:
                return team_role
        return entry_role

    def update_team_role(self, role: TeamRole) -> None:
        """Modify this member's team-level role.

        Write a non-null value only if the team-level role is higher than the team
        entry role for this member's organization-level role. If the entry role is
        equal or greater, write null instead. We do this because the entry role would
        override a lesser team role, making it invisible in the UI and causing
        surprising behavior in case the user's orgg-level role is lowered.
        """
        entry_role = roles.get_entry_role(self.organizationmember.role)
        if role.priority > entry_role.priority:
            self.update(role=role.id)
        else:
            self.update(role=None)

    def get_scopes(self) -> FrozenSet[str]:
        """Get the scopes belonging to this member's team-level role."""
        if features.has("organizations:team-roles", self.organizationmember.organization):
            return self.organizationmember.organization.get_scopes(self.get_team_role())
        return frozenset()

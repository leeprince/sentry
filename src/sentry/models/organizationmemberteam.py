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

        If the role field is null, resolve to the team entry role given by this
        member's organization role.
        """
        entry_role = roles.get_entry_role(self.organizationmember.role)
        if self.role:
            team_role = team_roles.get(self.role)
            if team_role.priority > entry_role.priority:
                return team_role
        return entry_role

    def update_team_role(self, role: TeamRole) -> None:
        """Modify this member's team-level role.

        If the member has an organization role that gives an equal or higher entry
        role, write null to this object's role field. We do this because a persistent
        team role, if it is overshadowed by the entry role, would be effectively
        invisible in the UI, and would be surprising if it were left behind after the
        user's org-level role is lowered.
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

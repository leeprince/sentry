from unittest.mock import Mock

from django.contrib.auth.models import AnonymousUser

from sentry.auth import access
from sentry.models import (
    AuthIdentity,
    AuthProvider,
    ObjectStatus,
    Organization,
    TeamStatus,
    UserPermission,
    UserRole,
)
from sentry.testutils import TestCase


class FromUserTest(TestCase):
    def test_no_access(self):
        organization = self.create_organization()
        team = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])
        user = self.create_user()

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert not result.sso_is_valid
            assert not result.requires_sso
            assert not result.scopes
            assert not result.has_team_access(team)
            assert not result.has_team_scope(team, "project:read")
            assert not result.has_project_access(project)
            assert not result.has_projects_access([project])
            assert not result.has_project_scope(project, "project:read")
            assert not result.has_project_membership(project)
            assert not result.permissions

    def test_no_deleted_projects(self):
        user = self.create_user()
        organization = self.create_organization(owner=self.user)

        team = self.create_team(organization=organization)
        self.create_member(organization=organization, user=user, role="owner", teams=[team])
        deleted_project = self.create_project(
            organization=organization, status=ObjectStatus.PENDING_DELETION, teams=[team]
        )

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.has_project_access(deleted_project) is False
            assert result.has_project_membership(deleted_project) is False
            assert len(result.projects) == 0

    def test_no_deleted_teams(self):
        user = self.create_user()
        organization = self.create_organization(owner=self.user)

        team = self.create_team(organization=organization)
        deleted_team = self.create_team(
            organization=organization, status=TeamStatus.PENDING_DELETION
        )
        self.create_member(
            organization=organization, user=user, role="owner", teams=[team, deleted_team]
        )

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.has_team_access(team) is True
            assert result.has_team_access(deleted_team) is False
            assert result.teams == frozenset({team})

    def test_unique_projects(self):
        user = self.create_user()
        organization = self.create_organization(owner=self.user)

        team = self.create_team(organization=organization)
        other_team = self.create_team(organization=organization)
        self.create_member(
            organization=organization, user=user, role="owner", teams=[team, other_team]
        )
        project = self.create_project(organization=organization, teams=[team, other_team])

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.has_project_access(project)
            assert len(result.projects) == 1

    def test_mixed_access(self):
        user = self.create_user()
        organization = self.create_organization(flags=0)  # disable default allow_joinleave
        team = self.create_team(organization=organization)
        team_no_access = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])
        project_no_access = self.create_project(organization=organization, teams=[team_no_access])
        self.create_member(organization=organization, user=user, teams=[team])
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.has_project_access(project)
            assert not result.has_project_access(project_no_access)
            assert not result.has_projects_access([project, project_no_access])

    def test_owner_all_teams(self):
        user = self.create_user()
        organization = self.create_organization(owner=self.user)
        member = self.create_member(organization=organization, user=user, role="owner")
        team = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.sso_is_valid
            assert not result.requires_sso
            assert result.scopes == member.get_scopes()
            assert result.has_team_access(team)
            assert result.has_team_scope(team, "project:read")
            assert result.has_project_access(project)
            assert result.has_projects_access([project])
            assert result.has_project_scope(project, "project:read")
            # owners should have access but not membership
            assert result.has_project_membership(project) is False

    def test_member_no_teams_closed_membership(self):
        user = self.create_user()
        organization = self.create_organization(
            owner=self.user, flags=0  # disable default allow_joinleave
        )
        member = self.create_member(organization=organization, user=user, role="member")
        team = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.sso_is_valid
            assert not result.requires_sso
            assert result.scopes == member.get_scopes()
            assert not result.has_team_access(team)
            assert not result.has_team_scope(team, "project:read")
            assert not result.has_project_access(project)
            assert not result.has_projects_access([project])
            assert not result.has_project_scope(project, "project:read")
            assert not result.has_project_membership(project)

    def test_member_no_teams_open_membership(self):
        user = self.create_user()
        organization = self.create_organization(
            owner=self.user, flags=Organization.flags.allow_joinleave
        )
        member = self.create_member(organization=organization, user=user, role="member", teams=())
        team = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])

        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.sso_is_valid
            assert not result.requires_sso
            assert result.scopes == member.get_scopes()
            assert result.has_team_access(team)
            assert result.has_team_scope(team, "project:read")
            assert result.has_project_access(project)
            assert result.has_projects_access([project])
            assert result.has_project_scope(project, "project:read")
            assert not result.has_project_membership(project)

    def test_team_restricted_org_member_access(self):
        user = self.create_user()
        organization = self.create_organization()
        team = self.create_team(organization=organization)
        project = self.create_project(organization=organization, teams=[team])
        member = self.create_member(organization=organization, user=user, teams=[team])
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.sso_is_valid
            assert not result.requires_sso
            assert result.scopes == member.get_scopes()
            assert result.has_team_access(team)
            assert result.has_team_scope(team, "project:read")
            assert result.has_project_access(project)
            assert result.has_projects_access([project])
            assert result.has_project_scope(project, "project:read")
            assert result.has_project_membership(project)

    def test_unlinked_sso(self):
        user = self.create_user()
        organization = self.create_organization(owner=user)
        self.create_team(organization=organization)
        ap = AuthProvider.objects.create(organization=organization, provider="dummy")
        AuthIdentity.objects.create(auth_provider=ap, user=user)
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert not result.sso_is_valid
            assert result.requires_sso

    def test_unlinked_sso_with_no_owners(self):
        user = self.create_user()
        organization = self.create_organization(owner=user)
        self.create_team(organization=organization)
        AuthProvider.objects.create(organization=organization, provider="dummy")
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert not result.sso_is_valid
            assert not result.requires_sso

    def test_sso_without_link_requirement(self):
        user = self.create_user()
        organization = self.create_organization(owner=user)
        self.create_team(organization=organization)
        AuthProvider.objects.create(
            organization=organization, provider="dummy", flags=AuthProvider.flags.allow_unlinked
        )
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result.sso_is_valid
            assert not result.requires_sso

    def test_anonymous_user(self):
        user = self.create_user()
        anon_user = AnonymousUser()
        organization = self.create_organization(owner=user)
        # TODO: make test work with from_request
        result = access.from_user(anon_user, organization)
        assert result is access.DEFAULT

    def test_inactive_user(self):
        user = self.create_user(is_active=False)
        organization = self.create_organization(owner=user)
        request = self.make_request(user=user)
        results = [access.from_user(user, organization), access.from_request(request, organization)]

        for result in results:
            assert result is access.DEFAULT

    def test_superuser_permissions(self):
        user = self.create_user(is_superuser=True)
        UserPermission.objects.create(user=user, permission="test.permission")

        result = access.from_user(user)
        assert not result.has_permission("test.permission")

        result = access.from_user(user, is_superuser=True)
        assert result.has_permission("test.permission")


class FromRequestTest(TestCase):
    def test_superuser(self):
        user = self.create_user(is_superuser=True)
        UserPermission.objects.create(user=user, permission="test.permission")

        request = self.make_request(user=user, is_superuser=False)
        result = access.from_request(request)
        assert not result.has_permission("test.permission")

        request = self.make_request(user=user, is_superuser=True)
        result = access.from_request(request)
        assert result.has_permission("test.permission")

    def test_superuser_in_organization(self):
        org = self.create_organization()
        AuthProvider.objects.create(organization=org)
        team = self.create_team(organization=org)
        project = self.create_project(organization=org, teams=[team])

        user = self.create_user(is_superuser=True)
        self.create_member(user=user, organization=org, role="admin")
        UserPermission.objects.create(user=user, permission="test.permission")

        request = self.make_request(user=user, is_superuser=False)
        result = access.from_request(request, org)
        assert not result.has_permission("test.permission")
        assert not result.teams
        assert not result.projects

        request = self.make_request(user=user, is_superuser=True)
        result = access.from_request(request, org)
        assert result.has_permission("test.permission")

        assert result.role == "admin"
        assert result.has_global_access

        assert result.teams == frozenset({team})
        assert result.has_team_access(team)
        assert result.projects == frozenset({project})
        assert result.has_project_access(project)

        assert result.requires_sso
        assert not result.sso_is_valid

    def test_superuser_with_organization_without_membership(self):
        org = self.create_organization()
        AuthProvider.objects.create(organization=org)
        team = self.create_team(organization=org)
        project = self.create_project(organization=org, teams=[team])

        user = self.create_user(is_superuser=True)
        UserPermission.objects.create(user=user, permission="test.permission")

        request = self.make_request(user=user, is_superuser=True)
        result = access.from_request(request, org)
        assert result.has_permission("test.permission")

        assert not result.requires_sso
        assert result.sso_is_valid

        assert result.teams == frozenset({team})
        assert result.has_team_access(team)
        assert result.projects == frozenset({project})
        assert result.has_project_access(project)

    def test_superuser_with_team_membership(self):
        org = self.create_organization()
        AuthProvider.objects.create(organization=org)

        member_team = self.create_team(organization=org)
        member_project = self.create_project(organization=org, teams=[member_team])
        non_member_team = self.create_team(organization=org)
        non_member_project = self.create_project(organization=org, teams=[non_member_team])

        user = self.create_user(is_superuser=True)
        self.create_member(user=user, organization=org, role="admin", teams=[member_team])

        request = self.make_request(user=user, is_superuser=True)
        result = access.from_request(request, org)

        assert result.teams == frozenset({member_team, non_member_team})
        assert result.has_team_access(member_team)
        assert result.has_team_access(non_member_team)
        assert result.projects == frozenset({member_project, non_member_project})
        assert result.has_project_access(member_project)
        assert result.has_project_access(non_member_project)
        assert result.has_project_membership(member_project)

        # TODO: This should actually be false per the has_project_membership docstring
        assert result.has_project_membership(non_member_project)


class FromSentryAppTest(TestCase):
    def setUp(self):
        super().setUp()

        # Partner's normal Sentry account.
        self.user = self.create_user("integration@example.com")

        self.org = self.create_organization()
        self.org2 = self.create_organization()
        self.out_of_scope_org = self.create_organization()

        self.team = self.create_team(organization=self.org)
        self.team2 = self.create_team(organization=self.org2)
        self.out_of_scope_team = self.create_team(organization=self.out_of_scope_org)

        self.project = self.create_project(organization=self.org, teams=[self.team])
        self.out_of_scope_project = self.create_project(
            organization=self.out_of_scope_org, teams=[self.out_of_scope_team]
        )

        self.sentry_app = self.create_sentry_app(name="SlowDB", organization=self.org)
        self.out_of_scope_sentry_app = self.create_sentry_app(
            name="Other App", organization=self.out_of_scope_org
        )

        self.proxy_user = self.sentry_app.proxy_user
        self.out_of_scope_proxy_user = self.out_of_scope_sentry_app.proxy_user

        self.install = self.create_sentry_app_installation(
            organization=self.org, slug=self.sentry_app.slug, user=self.user
        )
        self.install2 = self.create_sentry_app_installation(
            organization=self.org2, slug=self.sentry_app.slug, user=self.user
        )

    def test_has_access(self):
        request = self.make_request(user=self.proxy_user)
        result = access.from_request(request, self.org)
        assert result.has_global_access
        assert result.has_team_access(self.team)
        assert result.teams == frozenset({self.team})
        assert result.scopes == frozenset()
        assert result.has_project_access(self.project)
        assert not result.has_project_access(self.out_of_scope_project)
        assert not result.permissions

    def test_no_access_due_to_no_installation_unowned(self):
        request = self.make_request(user=self.proxy_user)
        result = access.from_request(request, self.out_of_scope_org)
        assert not result.has_team_access(self.team)
        assert not result.has_team_access(self.team2)
        assert not result.has_team_access(self.out_of_scope_team)
        assert not result.has_project_access(self.project)
        assert not result.has_project_access(self.out_of_scope_project)

    def test_no_access_due_to_no_installation_owned(self):
        request = self.make_request(user=self.out_of_scope_proxy_user)
        result = access.from_request(request, self.out_of_scope_org)
        assert not result.has_team_access(self.team)
        assert not result.has_team_access(self.team2)
        assert not result.has_team_access(self.out_of_scope_team)
        assert not result.has_project_access(self.project)
        assert not result.has_project_access(self.out_of_scope_project)

    def test_no_access_due_to_invalid_user(self):
        request = self.make_request(user=self.out_of_scope_proxy_user)
        result = access.from_request(request, self.org)
        assert not result.has_team_access(self.team)
        assert not result.has_team_access(self.team2)
        assert not result.has_team_access(self.out_of_scope_team)
        assert not result.has_project_access(self.project)
        assert not result.has_project_access(self.out_of_scope_project)

    def test_no_deleted_projects(self):
        self.create_member(organization=self.org, user=self.user, role="owner", teams=[self.team])
        deleted_project = self.create_project(
            organization=self.org, status=ObjectStatus.PENDING_DELETION, teams=[self.team]
        )
        request = self.make_request(user=self.proxy_user)
        result = access.from_request(request, self.org)
        assert result.has_project_access(deleted_project) is False
        assert result.has_project_membership(deleted_project) is False

        # result.projects also contains other projects created by
        # self.create_sentry_app_installation
        assert deleted_project not in result.projects
        assert self.project in result.projects

    def test_no_deleted_teams(self):
        deleted_team = self.create_team(organization=self.org, status=TeamStatus.PENDING_DELETION)
        self.create_member(
            organization=self.org, user=self.user, role="owner", teams=[self.team, deleted_team]
        )
        request = self.make_request(user=self.proxy_user)
        result = access.from_request(request, self.org)
        assert result.has_team_access(deleted_team) is False
        assert result.teams == frozenset({self.team})

    def test_has_app_scopes(self):
        app_with_scopes = self.create_sentry_app(name="ScopeyTheApp", organization=self.org)
        app_with_scopes.update(scope_list=["team:read", "team:write"])
        self.create_sentry_app_installation(
            organization=self.org, slug=app_with_scopes.slug, user=self.user
        )

        request = self.make_request(user=app_with_scopes.proxy_user)
        result = access.from_request(request, self.org)
        assert result.scopes == frozenset({"team:read", "team:write"})
        assert result.has_scope("team:read") is True
        assert result.has_scope("team:write") is True
        assert result.has_scope("team:admin") is False


class DefaultAccessTest(TestCase):
    def test_no_access(self):
        result = access.DEFAULT
        assert result.sso_is_valid
        assert not result.scopes
        assert not result.has_team_access(Mock())
        assert not result.has_team_scope(Mock(), "project:read")
        assert not result.has_project_access(Mock())
        assert not result.has_projects_access([Mock()])
        assert not result.has_project_scope(Mock(), "project:read")
        assert not result.has_project_membership(Mock())
        assert not result.permissions


class GetPermissionsForUserTest(TestCase):
    def test_combines_roles_and_perms(self):
        user = self.user

        UserPermission.objects.create(user=user, permission="test.permission")
        role = UserRole.objects.create(name="test.role", permissions=["test.permission-role"])
        role.users.add(user)

        assert sorted(access.get_permissions_for_user(user.id)) == sorted(
            ["test.permission", "test.permission-role"]
        )

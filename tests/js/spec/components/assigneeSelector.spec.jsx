import {mountWithTheme} from 'sentry-test/enzyme';

import {openInviteMembersModal} from 'sentry/actionCreators/modal';
import {Client} from 'sentry/api';
import AssigneeSelectorComponent, {
  putSessionUserFirst,
} from 'sentry/components/assigneeSelector';
import ConfigStore from 'sentry/stores/configStore';
import GroupStore from 'sentry/stores/groupStore';
import MemberListStore from 'sentry/stores/memberListStore';
import ProjectsStore from 'sentry/stores/projectsStore';
import TeamStore from 'sentry/stores/teamStore';

jest.mock('sentry/actionCreators/modal', () => ({
  openInviteMembersModal: jest.fn(),
}));

describe('AssigneeSelector', function () {
  let assigneeSelector;
  let assignMock;
  let assignGroup2Mock;
  let openMenu;
  let USER_1, USER_2, USER_3;
  let TEAM_1;
  let PROJECT_1;
  let GROUP_1;
  let GROUP_2;

  beforeEach(function () {
    USER_1 = TestStubs.User({
      id: '1',
      name: 'Jane Bloggs',
      email: 'janebloggs@example.com',
    });
    USER_2 = TestStubs.User({
      id: '2',
      name: 'John Smith',
      email: 'johnsmith@example.com',
    });
    USER_3 = TestStubs.User({
      id: '3',
      name: 'J J',
      email: 'jj@example.com',
    });

    TEAM_1 = TestStubs.Team({
      id: '3',
      name: 'COOL TEAM',
      slug: 'cool-team',
    });

    PROJECT_1 = TestStubs.Project({
      teams: [TEAM_1],
    });

    GROUP_1 = TestStubs.Group({
      id: '1337',
      project: {
        id: PROJECT_1.id,
        slug: PROJECT_1.slug,
      },
    });

    GROUP_2 = TestStubs.Group({
      id: '1338',
      project: {
        id: PROJECT_1.id,
        slug: PROJECT_1.slug,
      },
      owners: [
        {
          type: 'suspectCommit',
          owner: 'user:1',
          date_added: '',
        },
      ],
    });

    jest.spyOn(MemberListStore, 'getAll').mockImplementation(() => null);
    jest.spyOn(TeamStore, 'getAll').mockImplementation(() => [TEAM_1]);
    jest.spyOn(ProjectsStore, 'getAll').mockImplementation(() => [PROJECT_1]);
    jest.spyOn(GroupStore, 'get').mockImplementation(() => GROUP_1);

    assignMock = Client.addMockResponse({
      method: 'PUT',
      url: `/issues/${GROUP_1.id}/`,
      body: {
        ...GROUP_1,
        assignedTo: USER_1,
      },
    });

    assignGroup2Mock = Client.addMockResponse({
      method: 'PUT',
      url: `/issues/${GROUP_2.id}/`,
      body: {
        ...GROUP_2,
        assignedTo: USER_1,
      },
    });

    MemberListStore.state = [];
    MemberListStore.loaded = false;

    assigneeSelector = mountWithTheme(<AssigneeSelectorComponent id={GROUP_1.id} />);

    openMenu = () => assigneeSelector.find('DropdownButton').simulate('click');
  });

  afterEach(function () {
    Client.clearMockResponses();
  });

  describe('render with props', function () {
    it('renders members from the prop when present', async function () {
      assigneeSelector = mountWithTheme(
        <AssigneeSelectorComponent id={GROUP_1.id} memberList={[USER_2, USER_3]} />
      );
      MemberListStore.loadInitialData([USER_1]);
      openMenu();

      assigneeSelector.update();
      expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(0);
      expect(assigneeSelector.find('UserAvatar')).toHaveLength(2);
      expect(assigneeSelector.find('TeamAvatar')).toHaveLength(1);

      const names = assigneeSelector
        .find('MenuItemWrapper Label Highlight')
        .map(el => el.text());
      expect(names).toEqual([`#${TEAM_1.slug}`, USER_2.name, USER_3.name]);
    });
  });

  describe('putSessionUserFirst()', function () {
    it('should place the session user at the top of the member list if present', function () {
      jest.spyOn(ConfigStore, 'get').mockImplementation(() => ({
        id: '2',
        name: 'John Smith',
        email: 'johnsmith@example.com',
      }));
      expect(putSessionUserFirst([USER_1, USER_2])).toEqual([USER_2, USER_1]);
      ConfigStore.get.mockRestore();
    });

    it("should return the same member list if the session user isn't present", function () {
      jest.spyOn(ConfigStore, 'get').mockImplementation(() => ({
        id: '555',
        name: 'Here Comes a New Challenger',
        email: 'guile@mail.us.af.mil',
      }));

      expect(putSessionUserFirst([USER_1, USER_2])).toEqual([USER_1, USER_2]);
      ConfigStore.get.mockRestore();
    });
  });

  it('should initially have loading state', function () {
    openMenu();
    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(1);
  });

  it('does not have loading state and shows member list after calling MemberListStore.loadInitialData', async function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();
    expect(assigneeSelector.instance().assignableTeams()).toHaveLength(1);

    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(0);
    expect(assigneeSelector.find('UserAvatar')).toHaveLength(2);
    expect(assigneeSelector.find('TeamAvatar')).toHaveLength(1);
  });

  it('does NOT update member list after initial load', function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();

    expect(assigneeSelector.find('UserAvatar')).toHaveLength(2);
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);

    MemberListStore.loadInitialData([USER_1, USER_2, USER_3]);
    assigneeSelector.update();

    expect(assigneeSelector.find('UserAvatar')).toHaveLength(2);
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);
  });

  it('successfully assigns users', async function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);

    assigneeSelector.find('UserAvatar').first().simulate('click');

    expect(assignMock).toHaveBeenLastCalledWith(
      '/issues/1337/',
      expect.objectContaining({
        data: {assignedTo: 'user:1', assignedBy: 'assignee_selector'},
      })
    );

    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(1);

    // Flakey with 1 tick
    await tick();
    await tick();
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(0);
    expect(assigneeSelector.find('ActorAvatar')).toHaveLength(1);
  });

  it('successfully assigns teams', async function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);

    assigneeSelector.find('TeamAvatar').first().simulate('click');

    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(true);

    expect(assignMock).toHaveBeenCalledWith(
      '/issues/1337/',
      expect.objectContaining({
        data: {assignedTo: 'team:3', assignedBy: 'assignee_selector'},
      })
    );

    // Flakey with 1 tick
    await tick();
    await tick();
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);
    expect(assigneeSelector.find('ActorAvatar')).toHaveLength(1);
  });

  it('successfully clears assignment', async function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);

    // Assign first item in list, which is TEAM_1
    assigneeSelector.update();
    assigneeSelector.find('TeamAvatar').first().simulate('click');
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(true);

    expect(assignMock).toHaveBeenCalledWith(
      '/issues/1337/',
      expect.objectContaining({
        data: {assignedTo: 'team:3', assignedBy: 'assignee_selector'},
      })
    );

    // Waiting for assignment to finish updating
    // Flakey with 1 tick
    await tick();
    await tick();
    assigneeSelector.update();

    openMenu();
    assigneeSelector
      .find('MenuItemWrapper[data-test-id="clear-assignee"]')
      .simulate('click');

    // api was called with empty string, clearing assignment
    expect(assignMock).toHaveBeenLastCalledWith(
      '/issues/1337/',
      expect.objectContaining({
        data: {assignedTo: '', assignedBy: 'assignee_selector'},
      })
    );
  });

  it('shows invite member button', async function () {
    jest.spyOn(ConfigStore, 'get').mockImplementation(() => true);

    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);
    assigneeSelector
      .find('InviteMemberLink[data-test-id="invite-member"]')
      .simulate('click');
    expect(openInviteMembersModal).toHaveBeenCalled();
    ConfigStore.get.mockRestore();
  });

  it('filters user by email and selects with keyboard', async function () {
    openMenu();
    MemberListStore.loadInitialData([USER_1, USER_2]);
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);

    assigneeSelector
      .find('StyledInput')
      .simulate('change', {target: {value: 'JohnSmith@example.com'}});

    expect(assigneeSelector.find('UserAvatar')).toHaveLength(1);
    expect(assigneeSelector.find('UserAvatar').prop('user')).toEqual(USER_2);

    assigneeSelector.find('StyledInput').simulate('keyDown', {key: 'Enter'});
    assigneeSelector.update();
    expect(assignMock).toHaveBeenLastCalledWith(
      '/issues/1337/',
      expect.objectContaining({
        data: {assignedTo: 'user:2', assignedBy: 'assignee_selector'},
      })
    );
    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(1);

    await tick();
    await tick();
    assigneeSelector.update();
    expect(assigneeSelector.find('LoadingIndicator')).toHaveLength(0);
    expect(assigneeSelector.find('ActorAvatar')).toHaveLength(1);
  });

  it('successfully shows suggested assignees', async function () {
    jest.spyOn(GroupStore, 'get').mockImplementation(() => GROUP_2);
    const onAssign = jest.fn();
    assigneeSelector = mountWithTheme(
      <AssigneeSelectorComponent id={GROUP_2.id} onAssign={onAssign} />
    );
    MemberListStore.loadInitialData([USER_1, USER_2, USER_3]);

    await tick();
    assigneeSelector.update();

    const avatarTooltip = mountWithTheme(assigneeSelector.find('Tooltip').prop('title'));
    expect(avatarTooltip.text()).toContain('Suggestion: Jane Bloggs');
    expect(avatarTooltip.text()).toContain('Based on commit data');

    openMenu();
    expect(assigneeSelector.find('LoadingIndicator').exists()).toBe(false);
    expect(assigneeSelector.find('SuggestedAvatarStack').exists()).toBe(true);

    expect(assigneeSelector.find('GroupHeader').first().text()).toEqual('Suggested');

    assigneeSelector.find('UserAvatar').at(1).simulate('click');

    assigneeSelector.update();

    expect(assignGroup2Mock).toHaveBeenCalledWith(
      '/issues/1338/',
      expect.objectContaining({
        data: {assignedTo: 'user:1', assignedBy: 'assignee_selector'},
      })
    );

    // Suggested assignees shouldn't show anymore because we assigned to the suggested actor
    assigneeSelector.update();
    expect(assigneeSelector.find('SuggestedAvatarStack').exists()).toBe(false);
    expect(onAssign).toHaveBeenCalledWith(
      'member',
      expect.objectContaining({id: '1'}),
      expect.objectContaining({id: '1'})
    );
  });

  it('renders unassigned', async function () {
    jest.spyOn(GroupStore, 'get').mockImplementation(() => GROUP_2);
    assigneeSelector = mountWithTheme(<AssigneeSelectorComponent id={GROUP_2.id} />);
    const avatarTooltip = mountWithTheme(assigneeSelector.find('Tooltip').prop('title'));
    expect(avatarTooltip.text()).toContain('Unassigned');
  });
});

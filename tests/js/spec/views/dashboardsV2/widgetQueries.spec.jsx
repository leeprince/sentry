import {mountWithTheme} from 'sentry-test/enzyme';
import {initializeOrg} from 'sentry-test/initializeOrg';

import {Client} from 'sentry/api';
import WidgetQueries from 'sentry/views/dashboardsV2/widgetCard/widgetQueries';

describe('Dashboards > WidgetQueries', function () {
  const initialData = initializeOrg({
    organization: TestStubs.Organization(),
  });

  const multipleQueryWidget = {
    title: 'Errors',
    interval: '5m',
    displayType: 'line',
    queries: [
      {
        conditions: 'event.type:error',
        fields: ['count()'],
        aggregates: ['count()'],
        columns: [],
        name: 'errors',
      },
      {
        conditions: 'event.type:default',
        fields: ['count()'],
        aggregates: ['count()'],
        columns: [],
        name: 'default',
      },
    ],
  };
  const singleQueryWidget = {
    title: 'Errors',
    interval: '5m',
    displayType: 'line',
    queries: [
      {
        conditions: 'event.type:error',
        fields: ['count()'],
        aggregates: ['count()'],
        columns: [],
        name: 'errors',
      },
    ],
  };
  const tableWidget = {
    title: 'SDK',
    interval: '5m',
    displayType: 'table',
    queries: [
      {
        conditions: 'event.type:error',
        fields: ['sdk.name'],
        aggregates: [],
        columns: ['sdk.name'],
        name: 'sdk',
      },
    ],
  };
  const selection = {
    projects: [1],
    environments: ['prod'],
    datetime: {
      period: '14d',
    },
  };

  const api = new Client();

  afterEach(function () {
    MockApiClient.clearMockResponses();
  });

  it('can send multiple API requests', async function () {
    const errorMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
      match: [MockApiClient.matchQuery({query: 'event.type:error'})],
    });
    const defaultMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
      match: [MockApiClient.matchQuery({query: 'event.type:default'})],
    });
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={multipleQueryWidget}
        organization={initialData.organization}
        selection={selection}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 2 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(defaultMock).toHaveBeenCalledTimes(1);
  });

  it('sets errorMessage when the first request fails', async function () {
    const okMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      match: [MockApiClient.matchQuery({query: 'event.type:error'})],
      body: [],
    });
    const failMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      statusCode: 400,
      body: {detail: 'Bad request data'},
      match: [MockApiClient.matchQuery({query: 'event.type:default'})],
    });

    let error = '';
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={multipleQueryWidget}
        organization={initialData.organization}
        selection={selection}
      >
        {({errorMessage}) => {
          error = errorMessage;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 2 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(okMock).toHaveBeenCalledTimes(1);
    expect(failMock).toHaveBeenCalledTimes(1);
    expect(error).toEqual('Bad request data');
  });

  it('adjusts interval based on date window', async function () {
    const errorMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
    });
    const widget = {...singleQueryWidget, interval: '1m'};

    const longSelection = {
      projects: [1],
      environments: ['prod', 'dev'],
      datetime: {
        period: '90d',
      },
    };
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={widget}
        organization={initialData.organization}
        selection={longSelection}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();

    // Child should be rendered and interval bumped up.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith(
      '/organizations/org-slug/events-stats/',
      expect.objectContaining({
        query: expect.objectContaining({
          interval: '4h',
          statsPeriod: '90d',
          environment: ['prod', 'dev'],
          project: [1],
        }),
      })
    );
  });

  it('adjusts interval based on date window 14d', async function () {
    const errorMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
    });
    const widget = {...singleQueryWidget, interval: '1m'};

    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={widget}
        organization={initialData.organization}
        selection={selection}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();

    // Child should be rendered and interval bumped up.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledWith(
      '/organizations/org-slug/events-stats/',
      expect.objectContaining({
        query: expect.objectContaining({interval: '30m'}),
      })
    );
  });

  it('can send table result queries', async function () {
    const tableMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/eventsv2/',
      body: {
        meta: {'sdk.name': 'string'},
        data: [{'sdk.name': 'python'}],
      },
    });

    let childProps = undefined;
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={tableWidget}
        organization={initialData.organization}
        selection={selection}
      >
        {props => {
          childProps = props;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(tableMock).toHaveBeenCalledTimes(1);
    expect(tableMock).toHaveBeenCalledWith(
      '/organizations/org-slug/eventsv2/',
      expect.objectContaining({
        query: expect.objectContaining({
          query: 'event.type:error',
          name: 'SDK',
          field: ['sdk.name'],
          statsPeriod: '14d',
          environment: ['prod'],
          project: [1],
        }),
      })
    );
    expect(childProps.timeseriesResults).toBeUndefined();
    expect(childProps.tableResults[0].data).toHaveLength(1);
    expect(childProps.tableResults[0].meta).toBeDefined();
  });

  it('can send multiple table queries', async function () {
    const firstQuery = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/eventsv2/',
      body: {
        meta: {'sdk.name': 'string'},
        data: [{'sdk.name': 'python'}],
      },
      match: [MockApiClient.matchQuery({query: 'event.type:error'})],
    });
    const secondQuery = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/eventsv2/',
      body: {
        meta: {title: 'string'},
        data: [{title: 'ValueError'}],
      },
      match: [MockApiClient.matchQuery({query: 'title:ValueError'})],
    });

    const widget = {
      title: 'SDK',
      interval: '5m',
      displayType: 'table',
      queries: [
        {
          conditions: 'event.type:error',
          fields: ['sdk.name'],
          aggregates: [],
          columns: ['sdk.name'],
          name: 'sdk',
        },
        {
          conditions: 'title:ValueError',
          fields: ['title'],
          aggregates: [],
          columns: ['sdk.name'],
          name: 'title',
        },
      ],
    };

    let childProps = undefined;
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={widget}
        organization={initialData.organization}
        selection={selection}
      >
        {props => {
          childProps = props;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 2 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(firstQuery).toHaveBeenCalledTimes(1);
    expect(secondQuery).toHaveBeenCalledTimes(1);

    expect(childProps.tableResults).toHaveLength(2);
    expect(childProps.tableResults[0].data[0]['sdk.name']).toBeDefined();
    expect(childProps.tableResults[1].data[0].title).toBeDefined();
  });

  it('can send big number result queries', async function () {
    const tableMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/eventsv2/',
      body: {
        meta: {'sdk.name': 'string'},
        data: [{'sdk.name': 'python'}],
      },
    });

    let childProps = undefined;
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={{
          title: 'SDK',
          interval: '5m',
          displayType: 'big_number',
          queries: [
            {
              conditions: 'event.type:error',
              fields: ['sdk.name'],
              aggregates: [],
              columns: ['sdk.name'],
              name: 'sdk',
            },
          ],
        }}
        organization={initialData.organization}
        selection={selection}
      >
        {props => {
          childProps = props;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(tableMock).toHaveBeenCalledTimes(1);
    expect(tableMock).toHaveBeenCalledWith(
      '/organizations/org-slug/eventsv2/',
      expect.objectContaining({
        query: expect.objectContaining({
          referrer: 'api.dashboards.bignumberwidget',
          query: 'event.type:error',
          name: 'SDK',
          field: ['sdk.name'],
          statsPeriod: '14d',
          environment: ['prod'],
          project: [1],
        }),
      })
    );
    expect(childProps.timeseriesResults).toBeUndefined();
    expect(childProps.tableResults[0].data).toHaveLength(1);
    expect(childProps.tableResults[0].meta).toBeDefined();
  });

  it('can send world map result queries', async function () {
    const tableMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-geo/',
      body: {
        meta: {'sdk.name': 'string'},
        data: [{'sdk.name': 'python'}],
      },
    });

    let childProps = undefined;
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={{
          title: 'SDK',
          interval: '5m',
          displayType: 'world_map',
          queries: [
            {
              conditions: 'event.type:error',
              fields: ['count()'],
              aggregates: [],
              columns: ['count()'],
              name: 'sdk',
            },
          ],
        }}
        organization={initialData.organization}
        selection={selection}
      >
        {props => {
          childProps = props;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(tableMock).toHaveBeenCalledTimes(1);
    expect(tableMock).toHaveBeenCalledWith(
      '/organizations/org-slug/events-geo/',
      expect.objectContaining({
        query: expect.objectContaining({
          referrer: 'api.dashboards.worldmapwidget',
          query: 'event.type:error',
          name: 'SDK',
          field: ['count()'],
          statsPeriod: '14d',
          environment: ['prod'],
          project: [1],
        }),
      })
    );
    expect(childProps.timeseriesResults).toBeUndefined();
    expect(childProps.tableResults[0].data).toHaveLength(1);
    expect(childProps.tableResults[0].meta).toBeDefined();
  });

  it('stops loading state once all queries finish even if some fail', async function () {
    const firstQuery = MockApiClient.addMockResponse({
      statusCode: 500,
      url: '/organizations/org-slug/eventsv2/',
      body: {detail: 'it didnt work'},
      match: [MockApiClient.matchQuery({query: 'event.type:error'})],
    });
    const secondQuery = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/eventsv2/',
      body: {
        meta: {title: 'string'},
        data: [{title: 'ValueError'}],
      },
      match: [MockApiClient.matchQuery({query: 'title:ValueError'})],
    });

    const widget = {
      title: 'SDK',
      interval: '5m',
      displayType: 'table',
      queries: [
        {
          conditions: 'event.type:error',
          fields: ['sdk.name'],
          aggregates: [],
          columns: ['sdk.name'],
          name: 'sdk',
        },
        {
          conditions: 'title:ValueError',
          fields: ['sdk.name'],
          aggregates: [],
          columns: ['sdk.name'],
          name: 'title',
        },
      ],
    };

    let childProps = undefined;
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={widget}
        organization={initialData.organization}
        selection={selection}
      >
        {props => {
          childProps = props;
          return <div data-test-id="child" />;
        }}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 2 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(firstQuery).toHaveBeenCalledTimes(1);
    expect(secondQuery).toHaveBeenCalledTimes(1);

    expect(childProps.loading).toEqual(false);
  });

  it('sets bar charts to 1d interval', async function () {
    const errorMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
      match: [MockApiClient.matchQuery({interval: '1d'})],
    });
    const barWidget = {
      ...singleQueryWidget,
      displayType: 'bar',
      // Should be ignored for bars.
      interval: '5m',
    };
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={barWidget}
        organization={initialData.organization}
        selection={selection}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it('returns timeseriesResults in the same order as widgetQuery', async function () {
    MockApiClient.clearMockResponses();
    const defaultMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      method: 'GET',
      body: {
        data: [
          [
            1000,
            [
              {
                count: 100,
              },
            ],
          ],
        ],
        start: 1000,
        end: 2000,
      },
      match: [MockApiClient.matchQuery({query: 'event.type:default'})],
    });
    const errorMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      method: 'GET',
      body: {
        data: [
          [
            1000,
            [
              {
                count: 200,
              },
            ],
          ],
        ],
        start: 1000,
        end: 2000,
      },
      match: [MockApiClient.matchQuery({query: 'event.type:error'})],
    });
    const barWidget = {
      ...multipleQueryWidget,
      displayType: 'bar',
      // Should be ignored for bars.
      interval: '5m',
    };
    const child = jest.fn(() => <div data-test-id="child" />);
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={barWidget}
        organization={initialData.organization}
        selection={selection}
      >
        {child}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();
    wrapper.update();

    expect(defaultMock).toHaveBeenCalledTimes(1);
    expect(errorMock).toHaveBeenCalledTimes(1);
    expect(child).toHaveBeenLastCalledWith(
      expect.objectContaining({
        timeseriesResults: [
          {data: [{name: 1000000, value: 200}], seriesName: 'errors : count()'},
          {data: [{name: 1000000, value: 100}], seriesName: 'default : count()'},
        ],
      })
    );
  });

  it('calls events-stats with desired 1d interval when interval buckets would exceed 66 and calculated interval is higher fidelity', async function () {
    const eventsStatsMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
    });
    const areaWidget = {
      ...singleQueryWidget,
      displayType: 'area',
      interval: '1d',
    };
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={areaWidget}
        organization={initialData.organization}
        selection={{
          ...selection,
          datetime: {
            period: '90d',
          },
        }}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(eventsStatsMock).toHaveBeenCalledTimes(1);
    expect(eventsStatsMock).toHaveBeenCalledWith(
      '/organizations/org-slug/events-stats/',
      expect.objectContaining({query: expect.objectContaining({interval: '1d'})})
    );
  });

  it('calls events-stats with 4h interval when interval buckets would exceed 66', async function () {
    const eventsStatsMock = MockApiClient.addMockResponse({
      url: '/organizations/org-slug/events-stats/',
      body: [],
    });
    const areaWidget = {
      ...singleQueryWidget,
      displayType: 'area',
      interval: '5m',
    };
    const wrapper = mountWithTheme(
      <WidgetQueries
        api={api}
        widget={areaWidget}
        organization={initialData.organization}
        selection={{
          ...selection,
          datetime: {
            period: '90d',
          },
        }}
      >
        {() => <div data-test-id="child" />}
      </WidgetQueries>,
      initialData.routerContext
    );
    await tick();
    await tick();

    // Child should be rendered and 1 requests should be sent.
    expect(wrapper.find('[data-test-id="child"]')).toHaveLength(1);
    expect(eventsStatsMock).toHaveBeenCalledTimes(1);
    expect(eventsStatsMock).toHaveBeenCalledWith(
      '/organizations/org-slug/events-stats/',
      expect.objectContaining({query: expect.objectContaining({interval: '4h'})})
    );
  });
});

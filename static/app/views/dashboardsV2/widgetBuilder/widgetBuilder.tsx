import {useEffect, useState} from 'react';
import {RouteComponentProps} from 'react-router';
import styled from '@emotion/styled';
import cloneDeep from 'lodash/cloneDeep';
import isEmpty from 'lodash/isEmpty';
import omit from 'lodash/omit';
import set from 'lodash/set';

import {validateWidget} from 'sentry/actionCreators/dashboards';
import {addErrorMessage, addSuccessMessage} from 'sentry/actionCreators/indicator';
import Button from 'sentry/components/button';
import {generateOrderOptions} from 'sentry/components/dashboards/widgetQueriesForm';
import SearchBar from 'sentry/components/events/searchBar';
import Input from 'sentry/components/forms/controls/input';
import RadioGroup from 'sentry/components/forms/controls/radioGroup';
import Field from 'sentry/components/forms/field';
import SelectControl from 'sentry/components/forms/selectControl';
import * as Layout from 'sentry/components/layouts/thirds';
import ExternalLink from 'sentry/components/links/externalLink';
import List from 'sentry/components/list';
import LoadingError from 'sentry/components/loadingError';
import PageFiltersContainer from 'sentry/components/organizations/pageFilters/container';
import {PanelAlert} from 'sentry/components/panels';
import SentryDocumentTitle from 'sentry/components/sentryDocumentTitle';
import {MAX_QUERY_LENGTH} from 'sentry/constants';
import {IconAdd, IconDelete} from 'sentry/icons';
import {t, tct} from 'sentry/locale';
import {PageContent} from 'sentry/styles/organization';
import space from 'sentry/styles/space';
import {
  DateString,
  Organization,
  PageFilters,
  SelectValue,
  TagCollection,
} from 'sentry/types';
import {defined} from 'sentry/utils';
import trackAdvancedAnalyticsEvent from 'sentry/utils/analytics/trackAdvancedAnalyticsEvent';
import {
  explodeField,
  generateFieldAsString,
  getAggregateAlias,
  getColumnsAndAggregatesAsStrings,
  QueryFieldValue,
} from 'sentry/utils/discover/fields';
import handleXhrErrorResponse from 'sentry/utils/handleXhrErrorResponse';
import Measurements, {
  MeasurementCollection,
} from 'sentry/utils/measurements/measurements';
import {SessionMetric} from 'sentry/utils/metrics/fields';
import {SPAN_OP_BREAKDOWN_FIELDS} from 'sentry/utils/performance/spanOperationBreakdowns/constants';
import useApi from 'sentry/utils/useApi';
import withPageFilters from 'sentry/utils/withPageFilters';
import withTags from 'sentry/utils/withTags';
import {
  assignTempId,
  enforceWidgetHeightValues,
  generateWidgetsAfterCompaction,
  getDefaultWidgetHeight,
} from 'sentry/views/dashboardsV2/layoutUtils';
import {
  DashboardDetails,
  DashboardListItem,
  DashboardWidgetSource,
  Widget,
  WidgetQuery,
  WidgetType,
} from 'sentry/views/dashboardsV2/types';
import {
  generateIssueWidgetFieldOptions,
  generateIssueWidgetOrderOptions,
} from 'sentry/views/dashboardsV2/widgetBuilder/issueWidget/utils';
import {generateFieldOptions} from 'sentry/views/eventsV2/utils';
import {IssueSortOptions} from 'sentry/views/issueList/utils';

import {DEFAULT_STATS_PERIOD} from '../data';
import WidgetCard from '../widgetCard';

import BuildStep from './buildStep';
import {ColumnFields} from './columnFields';
import {DashboardSelector} from './dashboardSelector';
import {DisplayTypeSelector} from './displayTypeSelector';
import {Footer} from './footer';
import {Header} from './header';
import {SortBySelectors} from './sortBySelectors';
import {
  DataSet,
  DisplayType,
  getParsedDefaultWidgetQuery,
  mapErrors,
  normalizeQueries,
  SortDirection,
} from './utils';
import {WidgetLibrary} from './widgetLibrary';
import {YAxisSelector} from './yAxisSelector';

const NEW_DASHBOARD_ID = 'new';

const DATASET_CHOICES: [DataSet, string][] = [
  [DataSet.EVENTS, t('All Events (Errors and Transactions)')],
  [DataSet.ISSUES, t('Issues (States, Assignment, Time, etc.)')],
  // [DataSet.METRICS, t('Metrics (Release Health)')],
];

function getDataSetQuery(widgetBuilderNewDesign: boolean): Record<DataSet, WidgetQuery> {
  return {
    [DataSet.EVENTS]: {
      name: '',
      fields: ['count()'],
      columns: [],
      aggregates: ['count()'],
      conditions: '',
      orderby: widgetBuilderNewDesign ? 'count' : '',
    },
    [DataSet.ISSUES]: {
      name: '',
      fields: ['issue', 'assignee', 'title'] as string[],
      columns: ['issue', 'assignee', 'title'],
      aggregates: [],
      conditions: '',
      orderby: widgetBuilderNewDesign ? IssueSortOptions.DATE : '',
    },
    [DataSet.METRICS]: {
      name: '',
      fields: [`sum(${SessionMetric.SESSION})`],
      columns: [],
      aggregates: [`sum(${SessionMetric.SESSION})`],
      conditions: '',
      orderby: '',
    },
  };
}

const WIDGET_TYPE_TO_DATA_SET = {
  [WidgetType.DISCOVER]: DataSet.EVENTS,
  [WidgetType.ISSUE]: DataSet.ISSUES,
  // [WidgetType.METRICS]: DataSet.METRICS,
};

interface RouteParams {
  orgId: string;
  dashboardId?: string;
  widgetIndex?: number;
}

interface QueryData {
  queryConditions: string[];
  queryFields: string[];
  queryNames: string[];
  queryOrderby: string;
}

interface Props extends RouteComponentProps<RouteParams, {}> {
  dashboard: DashboardDetails;
  onSave: (widgets: Widget[]) => void;
  organization: Organization;
  selection: PageFilters;
  tags: TagCollection;
  displayType?: DisplayType;
  end?: DateString;
  start?: DateString;
  statsPeriod?: string | null;
  widget?: Widget;
}

interface State {
  dashboards: DashboardListItem[];
  dataSet: DataSet;
  displayType: Widget['displayType'];
  interval: Widget['interval'];
  loading: boolean;
  queries: Widget['queries'];
  title: string;
  userHasModified: boolean;
  errors?: Record<string, any>;
  selectedDashboard?: SelectValue<string>;
}

function WidgetBuilder({
  dashboard,
  widget: widgetToBeUpdated,
  params,
  location,
  organization,
  selection,
  start,
  end,
  statsPeriod,
  tags,
  onSave,
  router,
}: Props) {
  const {widgetIndex, orgId, dashboardId} = params;
  const {source, displayType, defaultTitle, defaultTableColumns} = location.query;
  const defaultWidgetQuery = getParsedDefaultWidgetQuery(
    location.query.defaultWidgetQuery
  );

  const isEditing = defined(widgetIndex);
  const orgSlug = organization.slug;
  const widgetBuilderNewDesign = organization.features.includes(
    'new-widget-builder-experience-design'
  );

  // Construct PageFilters object using statsPeriod/start/end props so we can
  // render widget graph using saved timeframe from Saved/Prebuilt Query
  const pageFilters: PageFilters = statsPeriod
    ? {...selection, datetime: {start: null, end: null, period: statsPeriod, utc: null}}
    : start && end
    ? {...selection, datetime: {start, end, period: null, utc: null}}
    : selection;

  // when opening from discover or issues page, the user selects the dashboard in the widget UI
  const notDashboardsOrigin = [
    DashboardWidgetSource.DISCOVERV2,
    DashboardWidgetSource.ISSUE_DETAILS,
  ].includes(source);

  const api = useApi();

  const [state, setState] = useState<State>(() => {
    if (!widgetToBeUpdated) {
      return {
        title: defaultTitle ?? t('Custom Widget'),
        displayType: displayType ?? DisplayType.TABLE,
        interval: '5m',
        queries: [
          defaultWidgetQuery
            ? widgetBuilderNewDesign
              ? {
                  ...defaultWidgetQuery,
                  orderby:
                    defaultWidgetQuery.orderby ||
                    generateOrderOptions({
                      widgetType: WidgetType.DISCOVER,
                      widgetBuilderNewDesign,
                      columns: defaultWidgetQuery.columns,
                      aggregates: defaultWidgetQuery.aggregates,
                    })[0].value,
                }
              : {...defaultWidgetQuery}
            : {...getDataSetQuery(widgetBuilderNewDesign)[DataSet.EVENTS]},
        ],
        errors: undefined,
        loading: !!notDashboardsOrigin,
        dashboards: [],
        userHasModified: false,
        dataSet: DataSet.EVENTS,
      };
    }

    return {
      title: widgetToBeUpdated.title,
      displayType: widgetToBeUpdated.displayType,
      interval: widgetToBeUpdated.interval,
      queries: normalizeQueries({
        displayType: widgetToBeUpdated.displayType,
        queries: widgetToBeUpdated.queries,
        widgetType: widgetToBeUpdated.widgetType ?? WidgetType.DISCOVER,
        widgetBuilderNewDesign,
      }),
      errors: undefined,
      loading: false,
      dashboards: [],
      userHasModified: false,
      dataSet: widgetToBeUpdated.widgetType
        ? WIDGET_TYPE_TO_DATA_SET[widgetToBeUpdated.widgetType]
        : DataSet.EVENTS,
    };
  });

  const [blurTimeout, setBlurTimeout] = useState<null | number>(null);

  useEffect(() => {
    if (notDashboardsOrigin) {
      fetchDashboards();
    }
  }, [source]);

  const widgetType =
    state.dataSet === DataSet.EVENTS
      ? WidgetType.DISCOVER
      : state.dataSet === DataSet.ISSUES
      ? WidgetType.ISSUE
      : WidgetType.METRICS;

  const currentWidget = {
    title: state.title,
    displayType: state.displayType,
    interval: state.interval,
    queries: state.queries,
    widgetType,
  };

  const currentDashboardId = state.selectedDashboard?.value ?? dashboardId;
  const queryParamsWithoutSource = omit(location.query, 'source');
  const previousLocation = {
    pathname: currentDashboardId
      ? `/organizations/${orgId}/dashboard/${currentDashboardId}/`
      : `/organizations/${orgId}/dashboards/new/`,
    query: isEmpty(queryParamsWithoutSource) ? undefined : queryParamsWithoutSource,
  };

  function updateFieldsAccordingToDisplayType(newDisplayType: DisplayType) {
    setState(prevState => {
      const newState = cloneDeep(prevState);
      const normalized = normalizeQueries({
        displayType: newDisplayType,
        queries: prevState.queries,
        widgetType:
          prevState.dataSet === DataSet.EVENTS ? WidgetType.DISCOVER : WidgetType.ISSUE,
        widgetBuilderNewDesign,
      });

      if (newDisplayType === DisplayType.TOP_N) {
        // TOP N display should only allow a single query
        normalized.splice(1);
      }

      if (
        prevState.displayType === DisplayType.TABLE &&
        widgetToBeUpdated?.widgetType &&
        WIDGET_TYPE_TO_DATA_SET[widgetToBeUpdated.widgetType] === DataSet.ISSUES
      ) {
        // World Map display type only supports Events Dataset
        // so set state to default events query.
        set(
          newState,
          'queries',
          normalizeQueries({
            displayType: newDisplayType,
            queries: [{...getDataSetQuery(widgetBuilderNewDesign)[DataSet.EVENTS]}],
            widgetType: WidgetType.DISCOVER,
            widgetBuilderNewDesign,
          })
        );
        set(newState, 'dataSet', DataSet.EVENTS);
        return {...newState, errors: undefined};
      }

      if (!prevState.userHasModified) {
        // If the Widget is an issue widget,
        if (
          newDisplayType === DisplayType.TABLE &&
          widgetToBeUpdated?.widgetType === WidgetType.ISSUE
        ) {
          set(newState, 'queries', widgetToBeUpdated.queries);
          set(newState, 'dataSet', DataSet.ISSUES);
          return {...newState, errors: undefined};
        }

        // Default widget provided by Add to Dashboard from Discover
        if (defaultWidgetQuery && defaultTableColumns) {
          // If switching to Table visualization, use saved query fields for Y-Axis if user has not made query changes
          // This is so the widget can reflect the same columns as the table in Discover without requiring additional user input
          if (newDisplayType === DisplayType.TABLE) {
            normalized.forEach(query => {
              query.columns = [...defaultWidgetQuery.columns];
              query.aggregates = [...defaultWidgetQuery.aggregates];
              query.fields = [...defaultTableColumns];
            });
          } else if (newDisplayType === displayType) {
            // When switching back to original display type, default fields back to the fields provided from the discover query
            normalized.forEach(query => {
              query.fields = [
                ...defaultWidgetQuery.columns,
                ...defaultWidgetQuery.aggregates,
              ];
              query.aggregates = [...defaultWidgetQuery.aggregates];
              query.columns = [...defaultWidgetQuery.columns];
              if (!!defaultWidgetQuery.orderby) {
                query.orderby = defaultWidgetQuery.orderby;
              }
            });
          }
        }
      }

      if (prevState.dataSet === DataSet.ISSUES) {
        set(newState, 'dataSet', DataSet.EVENTS);
      }

      set(newState, 'queries', normalized);

      return {...newState, errors: undefined};
    });
  }

  function handleDisplayTypeOrTitleChange<
    F extends keyof Pick<State, 'displayType' | 'title'>
  >(field: F, value: State[F]) {
    trackAdvancedAnalyticsEvent('dashboards_views.add_widget_in_builder.change', {
      from: source,
      field,
      value,
      widget_type: widgetType,
      organization,
    });

    setState(prevState => {
      const newState = cloneDeep(prevState);
      set(newState, field, value);
      return {...newState, errors: undefined};
    });

    if (field === 'displayType' && value !== state.displayType) {
      updateFieldsAccordingToDisplayType(value as DisplayType);
    }
  }

  function handleDataSetChange(newDataSet: string) {
    setState(prevState => {
      const newState = cloneDeep(prevState);
      newState.queries.splice(0, newState.queries.length);
      set(newState, 'dataSet', newDataSet);

      if (newDataSet === DataSet.ISSUES) {
        set(newState, 'displayType', DisplayType.TABLE);
      }

      newState.queries.push(
        ...(widgetToBeUpdated?.widgetType &&
        WIDGET_TYPE_TO_DATA_SET[widgetToBeUpdated.widgetType] === newDataSet
          ? widgetToBeUpdated.queries
          : [{...getDataSetQuery(widgetBuilderNewDesign)[newDataSet]}])
      );

      set(newState, 'userHasModified', true);
      return {...newState, errors: undefined};
    });
  }

  function handleAddSearchConditions() {
    setState(prevState => {
      const newState = cloneDeep(prevState);
      const query = cloneDeep(getDataSetQuery(widgetBuilderNewDesign)[DataSet.EVENTS]);
      query.fields = prevState.queries[0].fields;
      query.aggregates = prevState.queries[0].aggregates;
      query.columns = prevState.queries[0].columns;
      newState.queries.push(query);
      return newState;
    });
  }

  function handleQueryRemove(index: number) {
    setState(prevState => {
      const newState = cloneDeep(prevState);
      newState.queries.splice(index, 1);
      return {...newState, errors: undefined};
    });
  }

  function handleQueryChange(queryIndex: number, newQuery: WidgetQuery) {
    setState(prevState => {
      const newState = cloneDeep(prevState);
      set(newState, `queries.${queryIndex}`, newQuery);
      set(newState, 'userHasModified', true);
      return {...newState, errors: undefined};
    });
  }

  function handleYAxisChange(newYAxis: QueryFieldValue[]) {
    const aggregateAliasFieldStrings = newYAxis.map(generateFieldAsString);

    for (const index in state.queries) {
      const queryIndex = Number(index);
      const query = state.queries[queryIndex];

      const descending = query.orderby.startsWith('-');
      const orderbyAggregateAliasField = query.orderby.replace('-', '');
      const prevAggregateAliasFieldStrings = query.aggregates.map(getAggregateAlias);
      const newQuery = cloneDeep(query);
      newQuery.aggregates = aggregateAliasFieldStrings;
      newQuery.fields = [...newQuery.columns, ...aggregateAliasFieldStrings];
      if (
        !aggregateAliasFieldStrings.includes(orderbyAggregateAliasField) &&
        query.orderby !== ''
      ) {
        if (prevAggregateAliasFieldStrings.length === newYAxis.length) {
          // The Field that was used in orderby has changed. Get the new field.
          newQuery.orderby = `${descending && '-'}${
            aggregateAliasFieldStrings[
              prevAggregateAliasFieldStrings.indexOf(orderbyAggregateAliasField)
            ]
          }`;
        } else {
          newQuery.orderby = '';
        }
      }

      handleQueryChange(queryIndex, newQuery);
    }
  }

  function handleYAxisOrColumnFieldChange(newFields: QueryFieldValue[]) {
    const {aggregates, columns} = getColumnsAndAggregatesAsStrings(newFields);
    const fieldStrings = newFields.map(generateFieldAsString);
    const aggregateAliasFieldStrings = fieldStrings.map(getAggregateAlias);

    for (const index in state.queries) {
      const queryIndex = Number(index);
      const query = state.queries[queryIndex];

      const descending = query.orderby.startsWith('-');
      const orderbyAggregateAliasField = query.orderby.replace('-', '');
      const prevAggregateAliasFieldStrings = query.aggregates.map(getAggregateAlias);
      const newQuery = cloneDeep(query);
      newQuery.fields = fieldStrings;
      newQuery.aggregates = aggregates;
      newQuery.columns = columns;
      if (
        !aggregateAliasFieldStrings.includes(orderbyAggregateAliasField) &&
        query.orderby !== ''
      ) {
        if (prevAggregateAliasFieldStrings.length === newFields.length) {
          // The Field that was used in orderby has changed. Get the new field.
          newQuery.orderby = `${descending && '-'}${
            aggregateAliasFieldStrings[
              prevAggregateAliasFieldStrings.indexOf(orderbyAggregateAliasField)
            ]
          }`;
        } else {
          newQuery.orderby = '';
        }
      }

      if (widgetBuilderNewDesign && queryIndex === 0) {
        newQuery.orderby = aggregateAliasFieldStrings[0];
      }

      handleQueryChange(queryIndex, newQuery);
    }
  }

  function handleDelete() {
    if (!isEditing) {
      return;
    }

    let nextWidgetList = [...dashboard.widgets];
    nextWidgetList.splice(widgetIndex, 1);
    nextWidgetList = generateWidgetsAfterCompaction(nextWidgetList);

    onSave(nextWidgetList);
    router.push(previousLocation);
  }

  async function handleSave() {
    const widgetData: Widget = assignTempId(currentWidget);

    if (widgetToBeUpdated) {
      widgetData.layout = widgetToBeUpdated?.layout;
    }

    // Only Table and Top N views need orderby
    if (![DisplayType.TABLE, DisplayType.TOP_N].includes(widgetData.displayType)) {
      widgetData.queries.forEach(query => {
        query.orderby = '';
      });
    }

    if (!(await dataIsValid(widgetData))) {
      return;
    }

    if (notDashboardsOrigin) {
      submitFromSelectedDashboard(widgetData);
      return;
    }

    if (!!widgetToBeUpdated) {
      let nextWidgetList = [...dashboard.widgets];
      const updateIndex = nextWidgetList.indexOf(widgetToBeUpdated);
      const nextWidgetData = {...widgetData, id: widgetToBeUpdated.id};

      // Only modify and re-compact if the default height has changed
      if (
        getDefaultWidgetHeight(widgetToBeUpdated.displayType) !==
        getDefaultWidgetHeight(widgetData.displayType)
      ) {
        nextWidgetList[updateIndex] = enforceWidgetHeightValues(nextWidgetData);
        nextWidgetList = generateWidgetsAfterCompaction(nextWidgetList);
      } else {
        nextWidgetList[updateIndex] = nextWidgetData;
      }

      onSave(nextWidgetList);
      addSuccessMessage(t('Updated widget.'));
      goToDashboards(dashboardId ?? NEW_DASHBOARD_ID);
      trackAdvancedAnalyticsEvent('dashboards_views.edit_widget_in_builder.confirm', {
        organization,
      });
      return;
    }

    onSave([...dashboard.widgets, widgetData]);
    addSuccessMessage(t('Added widget.'));
    goToDashboards(dashboardId ?? NEW_DASHBOARD_ID);
    trackAdvancedAnalyticsEvent('dashboards_views.add_widget_in_builder.confirm', {
      organization,
      data_set: widgetData.widgetType ?? WidgetType.DISCOVER,
    });
  }

  async function dataIsValid(widgetData: Widget): Promise<boolean> {
    if (notDashboardsOrigin) {
      // Validate that a dashboard was selected since api call to /dashboards/widgets/ does not check for dashboard
      if (
        !state.selectedDashboard ||
        !(
          state.dashboards.find(
            ({title, id}) =>
              title === state.selectedDashboard?.label &&
              id === state.selectedDashboard?.value
          ) || state.selectedDashboard.value === NEW_DASHBOARD_ID
        )
      ) {
        setState({
          ...state,
          errors: {...state.errors, dashboard: t('This field may not be blank')},
        });
        return false;
      }
    }

    setState({...state, loading: true});

    try {
      await validateWidget(api, organization.slug, widgetData);
      return true;
    } catch (error) {
      setState({
        ...state,
        loading: false,
        errors: {...state.errors, ...mapErrors(error?.responseJSON ?? {}, {})},
      });
      return false;
    }
  }

  async function fetchDashboards() {
    const promise: Promise<DashboardListItem[]> = api.requestPromise(
      `/organizations/${organization.slug}/dashboards/`,
      {
        method: 'GET',
        query: {sort: 'myDashboardsAndRecentlyViewed'},
      }
    );

    try {
      const dashboards = await promise;
      setState({...state, dashboards, loading: false});
    } catch (error) {
      const errorMessage = t('Unable to fetch dashboards');
      addErrorMessage(errorMessage);
      handleXhrErrorResponse(errorMessage)(error);
      setState({...state, loading: false});
    }
  }

  function submitFromSelectedDashboard(widgetData: Widget) {
    if (!state.selectedDashboard) {
      return;
    }

    const queryData: QueryData = {
      queryNames: [],
      queryConditions: [],
      queryFields: [
        ...widgetData.queries[0].columns,
        ...widgetData.queries[0].aggregates,
      ],
      queryOrderby: widgetData.queries[0].orderby,
    };

    widgetData.queries.forEach(query => {
      queryData.queryNames.push(query.name);
      queryData.queryConditions.push(query.conditions);
    });

    const pathQuery = {
      displayType: widgetData.displayType,
      interval: widgetData.interval,
      title: widgetData.title,
      ...queryData,
      // Propagate page filters
      project: pageFilters.projects,
      environment: pageFilters.environments,
      ...omit(pageFilters.datetime, 'period'),
      statsPeriod: pageFilters.datetime?.period,
    };

    addSuccessMessage(t('Added widget.'));
    goToDashboards(state.selectedDashboard.value, pathQuery);
  }

  function goToDashboards(id: string, query?: Record<string, any>) {
    const pathQuery =
      !isEmpty(queryParamsWithoutSource) || query
        ? {
            ...queryParamsWithoutSource,
            ...query,
          }
        : undefined;

    if (id === NEW_DASHBOARD_ID) {
      router.push({
        pathname: `/organizations/${organization.slug}/dashboards/new/`,
        query: pathQuery,
      });
      return;
    }

    router.push({
      pathname: `/organizations/${organization.slug}/dashboard/${id}/`,
      query: pathQuery,
    });
  }

  function getAmendedFieldOptions(measurements: MeasurementCollection) {
    return generateFieldOptions({
      organization,
      tagKeys: Object.values(tags).map(({key}) => key),
      measurementKeys: Object.values(measurements).map(({key}) => key),
      spanOperationBreakdownKeys: SPAN_OP_BREAKDOWN_FIELDS,
    });
  }

  function isFormInvalid() {
    if (notDashboardsOrigin && !state.selectedDashboard) {
      return true;
    }

    return false;
  }

  if (isEditing && widgetIndex >= dashboard.widgets.length) {
    return (
      <SentryDocumentTitle title={dashboard.title} orgSlug={orgSlug}>
        <PageContent>
          <LoadingError message={t('The widget you want to edit was not found.')} />
        </PageContent>
      </SentryDocumentTitle>
    );
  }

  const canAddSearchConditions =
    [
      DisplayType.LINE,
      DisplayType.AREA,
      DisplayType.STACKED_AREA,
      DisplayType.BAR,
    ].includes(state.displayType) && state.queries.length < 3;

  const hideLegendAlias = [
    DisplayType.TABLE,
    DisplayType.WORLD_MAP,
    DisplayType.BIG_NUMBER,
  ].includes(state.displayType);

  const {columns, aggregates, fields} = state.queries[0];
  const explodedColumns = columns.map(field => explodeField({field}));
  const explodedAggregates = aggregates.map(field => explodeField({field}));
  const explodedFields = defined(fields)
    ? fields.map(field => explodeField({field}))
    : [...explodedColumns, ...explodedAggregates];
  const orderBy = state.queries[0].orderby;

  return (
    <SentryDocumentTitle title={dashboard.title} orgSlug={orgSlug}>
      <PageFiltersContainer
        skipLoadLastUsed={organization.features.includes('global-views')}
        defaultSelection={{
          datetime: {start: null, end: null, utc: false, period: DEFAULT_STATS_PERIOD},
        }}
      >
        <PageContentWithoutPadding>
          <Header
            orgSlug={orgSlug}
            title={state.title}
            dashboardTitle={dashboard.title}
            goBackLocation={previousLocation}
            onChangeTitle={newTitle => {
              handleDisplayTypeOrTitleChange('title', newTitle);
            }}
          />
          <Body>
            <MainWrapper>
              <Main>
                <BuildSteps symbol="colored-numeric">
                  <BuildStep
                    title={t('Choose your visualization')}
                    description={t(
                      'This is a preview of how your widget will appear in the dashboard.'
                    )}
                  >
                    <DisplayTypeSelector
                      displayType={state.displayType}
                      onChange={(option: {label: string; value: DisplayType}) => {
                        handleDisplayTypeOrTitleChange('displayType', option.value);
                      }}
                      error={state.errors?.displayType}
                    />
                    <VisualizationWrapper displayType={state.displayType}>
                      <WidgetCard
                        organization={organization}
                        selection={pageFilters}
                        widget={currentWidget}
                        isEditing={false}
                        widgetLimitReached={false}
                        renderErrorMessage={errorMessage =>
                          typeof errorMessage === 'string' && (
                            <PanelAlert type="error">{errorMessage}</PanelAlert>
                          )
                        }
                        isSorting={false}
                        currentWidgetDragging={false}
                        noLazyLoad
                      />
                    </VisualizationWrapper>
                  </BuildStep>
                  <BuildStep
                    title={t('Choose your data set')}
                    description={t(
                      'This reflects the type of information you want to use. For a full list, read the docs.'
                    )}
                  >
                    <DataSetChoices
                      label="dataSet"
                      value={state.dataSet}
                      choices={DATASET_CHOICES}
                      disabledChoices={
                        state.displayType !== DisplayType.TABLE
                          ? [
                              [
                                DataSet.ISSUES,
                                t(
                                  'This data set is restricted to the table visualization.'
                                ),
                              ],
                            ]
                          : undefined
                      }
                      onChange={handleDataSetChange}
                    />
                  </BuildStep>
                  {[DisplayType.TABLE, DisplayType.TOP_N].includes(state.displayType) && (
                    <BuildStep
                      title={t('Choose your columns')}
                      description={
                        state.dataSet !== DataSet.ISSUES
                          ? tct(
                              'To group events, add [functionLink: functions] f(x) that may take in additional parameters. [tagFieldLink: Tag and field] columns will help you view more details about the events (i.e. title).',
                              {
                                functionLink: (
                                  <ExternalLink href="https://docs.sentry.io/product/discover-queries/query-builder/#filter-by-table-columns" />
                                ),
                                tagFieldLink: (
                                  <ExternalLink href="https://docs.sentry.io/product/sentry-basics/search/searchable-properties/#event-properties" />
                                ),
                              }
                            )
                          : tct(
                              '[tagFieldLink: Tag and field] columns will help you view more details about the issues (i.e. title).',
                              {
                                tagFieldLink: (
                                  <ExternalLink href="https://docs.sentry.io/product/sentry-basics/search/searchable-properties/#event-properties" />
                                ),
                              }
                            )
                      }
                    >
                      {state.dataSet === DataSet.EVENTS ? (
                        <Measurements>
                          {({measurements}) => (
                            <ColumnFields
                              displayType={state.displayType}
                              organization={organization}
                              widgetType={widgetType}
                              columns={explodedColumns}
                              aggregates={explodedAggregates}
                              fields={explodedFields}
                              errors={state.errors?.queries}
                              fieldOptions={getAmendedFieldOptions(measurements)}
                              onChange={handleYAxisOrColumnFieldChange}
                            />
                          )}
                        </Measurements>
                      ) : (
                        <ColumnFields
                          displayType={state.displayType}
                          organization={organization}
                          widgetType={widgetType}
                          columns={explodedColumns}
                          aggregates={explodedAggregates}
                          fields={explodedFields}
                          errors={
                            state.errors?.queries?.[0]
                              ? [state.errors?.queries?.[0]]
                              : undefined
                          }
                          fieldOptions={generateIssueWidgetFieldOptions()}
                          onChange={newFields => {
                            const fieldStrings = newFields.map(generateFieldAsString);
                            const splitFields =
                              getColumnsAndAggregatesAsStrings(newFields);
                            const newQuery = cloneDeep(state.queries[0]);
                            newQuery.fields = fieldStrings;
                            newQuery.aggregates = splitFields.aggregates;
                            newQuery.columns = splitFields.columns;
                            handleQueryChange(0, newQuery);
                          }}
                        />
                      )}
                    </BuildStep>
                  )}
                  {![DisplayType.TABLE].includes(state.displayType) && (
                    <BuildStep
                      title={
                        displayType === DisplayType.BIG_NUMBER
                          ? t('Choose what to plot')
                          : t('Choose what to plot in the y-axis')
                      }
                      description={
                        [DisplayType.AREA, DisplayType.BAR, DisplayType.LINE].includes(
                          displayType
                        )
                          ? t(
                              "This is the data you'd be visualizing in the display. You can chart multiple overlays if they share a similar unit."
                            )
                          : t("This is the data you'd be visualizing in the display.")
                      }
                    >
                      <Measurements>
                        {({measurements}) => (
                          <YAxisSelector
                            widgetType={widgetType}
                            displayType={state.displayType}
                            aggregates={explodedAggregates}
                            fieldOptions={getAmendedFieldOptions(measurements)}
                            onChange={handleYAxisChange}
                            errors={state.errors?.queries}
                          />
                        )}
                      </Measurements>
                    </BuildStep>
                  )}
                  <BuildStep
                    title={t('Filter your results')}
                    description={
                      canAddSearchConditions
                        ? t(
                            'This is how you filter down your search. You can add multiple queries to compare data.'
                          )
                        : t('This is how you filter down your search.')
                    }
                  >
                    <div>
                      {state.queries.map((query, queryIndex) => {
                        return (
                          <QueryField
                            key={queryIndex}
                            inline={false}
                            flexibleControlStateSize
                            stacked
                            error={state.errors?.queries?.[queryIndex]?.conditions}
                          >
                            <SearchConditionsWrapper>
                              <Search
                                searchSource="widget_builder"
                                organization={organization}
                                projectIds={selection.projects}
                                query={query.conditions}
                                fields={[]}
                                onSearch={field => {
                                  // SearchBar will call handlers for both onSearch and onBlur
                                  // when selecting a value from the autocomplete dropdown. This can
                                  // cause state issues for the search bar in our use case. To prevent
                                  // this, we set a timer in our onSearch handler to block our onBlur
                                  // handler from firing if it is within 200ms, ie from clicking an
                                  // autocomplete value.
                                  setBlurTimeout(
                                    window.setTimeout(() => {
                                      setBlurTimeout(null);
                                    }, 200)
                                  );

                                  const newQuery: WidgetQuery = {
                                    ...state.queries[queryIndex],
                                    conditions: field,
                                  };
                                  handleQueryChange(queryIndex, newQuery);
                                }}
                                onBlur={field => {
                                  if (!blurTimeout) {
                                    const newQuery: WidgetQuery = {
                                      ...state.queries[queryIndex],
                                      conditions: field,
                                    };
                                    handleQueryChange(queryIndex, newQuery);
                                  }
                                }}
                                useFormWrapper={false}
                                maxQueryLength={MAX_QUERY_LENGTH}
                              />
                              {!hideLegendAlias && (
                                <LegendAliasInput
                                  type="text"
                                  name="name"
                                  value={query.name}
                                  placeholder={t('Legend Alias')}
                                  onChange={event => {
                                    const newQuery: WidgetQuery = {
                                      ...state.queries[queryIndex],
                                      name: event.target.value,
                                    };
                                    handleQueryChange(queryIndex, newQuery);
                                  }}
                                />
                              )}
                              {state.queries.length > 1 && (
                                <Button
                                  size="zero"
                                  borderless
                                  onClick={() => handleQueryRemove(queryIndex)}
                                  icon={<IconDelete />}
                                  title={t('Remove query')}
                                  aria-label={t('Remove query')}
                                />
                              )}
                            </SearchConditionsWrapper>
                          </QueryField>
                        );
                      })}
                      {canAddSearchConditions && (
                        <Button
                          size="small"
                          icon={<IconAdd isCircled />}
                          onClick={handleAddSearchConditions}
                        >
                          {t('Add query')}
                        </Button>
                      )}
                    </div>
                  </BuildStep>
                  {[DisplayType.TABLE, DisplayType.TOP_N].includes(state.displayType) && (
                    <BuildStep
                      title={t('Sort by a column')}
                      description={t(
                        "Choose one of the columns you've created to sort by."
                      )}
                    >
                      <Field
                        inline={false}
                        error={state.errors?.orderby}
                        flexibleControlStateSize
                        stacked
                      >
                        {widgetBuilderNewDesign ? (
                          <SortBySelectors
                            sortByOptions={
                              state.dataSet === DataSet.EVENTS
                                ? generateOrderOptions({
                                    widgetType,
                                    widgetBuilderNewDesign: true,
                                    columns: state.queries[0].columns,
                                    aggregates: state.queries[0].aggregates,
                                  })
                                : generateIssueWidgetOrderOptions(
                                    organization.features.includes(
                                      'issue-list-trend-sort'
                                    )
                                  )
                            }
                            values={{
                              sortDirection:
                                orderBy[0] === '-'
                                  ? SortDirection.HIGH_TO_LOW
                                  : SortDirection.LOW_TO_HIGH,
                              sortBy:
                                orderBy[0] === '-'
                                  ? orderBy.substring(1, orderBy.length)
                                  : orderBy,
                            }}
                            onChange={({sortDirection, sortBy}) => {
                              const newQuery: WidgetQuery = {
                                ...state.queries[0],
                                orderby:
                                  sortDirection === SortDirection.HIGH_TO_LOW
                                    ? `-${sortBy}`
                                    : sortBy,
                              };
                              handleQueryChange(0, newQuery);
                            }}
                          />
                        ) : (
                          <SelectControl
                            menuPlacement="auto"
                            value={
                              state.dataSet === DataSet.EVENTS
                                ? state.queries[0].orderby
                                : state.queries[0].orderby || IssueSortOptions.DATE
                            }
                            name="orderby"
                            options={
                              state.dataSet === DataSet.EVENTS
                                ? generateOrderOptions({
                                    widgetType,
                                    columns: state.queries[0].columns,
                                    aggregates: state.queries[0].aggregates,
                                  })
                                : generateIssueWidgetOrderOptions(
                                    organization.features.includes(
                                      'issue-list-trend-sort'
                                    )
                                  )
                            }
                            onChange={(option: SelectValue<string>) => {
                              const newQuery: WidgetQuery = {
                                ...state.queries[0],
                                orderby: option.value,
                              };
                              handleQueryChange(0, newQuery);
                            }}
                          />
                        )}
                      </Field>
                    </BuildStep>
                  )}
                  {notDashboardsOrigin && (
                    <BuildStep
                      title={t('Choose your dashboard')}
                      description={t(
                        "Choose which dashboard you'd like to add this query to. It will appear as a widget."
                      )}
                      required
                    >
                      <DashboardSelector
                        error={state.errors?.dashboard}
                        dashboards={state.dashboards}
                        onChange={selectedDashboard =>
                          setState({
                            ...state,
                            selectedDashboard,
                            errors: {...state.errors, dashboard: undefined},
                          })
                        }
                        disabled={state.loading}
                      />
                    </BuildStep>
                  )}
                </BuildSteps>
              </Main>
              <Footer
                goBackLocation={previousLocation}
                isEditing={isEditing}
                onSave={handleSave}
                onDelete={handleDelete}
                invalidForm={isFormInvalid()}
              />
            </MainWrapper>
            <Side>
              <WidgetLibrary
                onWidgetSelect={prebuiltWidget =>
                  setState({
                    ...state,
                    ...prebuiltWidget,
                    dataSet: prebuiltWidget.widgetType
                      ? WIDGET_TYPE_TO_DATA_SET[prebuiltWidget.widgetType]
                      : DataSet.EVENTS,
                    userHasModified: false,
                  })
                }
                bypassOverwriteModal={!state.userHasModified}
              />
            </Side>
          </Body>
        </PageContentWithoutPadding>
      </PageFiltersContainer>
    </SentryDocumentTitle>
  );
}

export default withPageFilters(withTags(WidgetBuilder));

const PageContentWithoutPadding = styled(PageContent)`
  padding: 0;
`;

const VisualizationWrapper = styled('div')<{displayType: DisplayType}>`
  overflow: ${p => (p.displayType === DisplayType.TABLE ? 'hidden' : 'visible')};
  padding-right: ${space(2)};
`;

const DataSetChoices = styled(RadioGroup)`
  @media (min-width: ${p => p.theme.breakpoints[2]}) {
    grid-auto-flow: column;
  }
`;

const SearchConditionsWrapper = styled('div')`
  display: flex;
  align-items: center;

  > * + * {
    margin-left: ${space(1)};
  }
`;

const Search = styled(SearchBar)`
  flex-grow: 1;
`;

const LegendAliasInput = styled(Input)`
  width: 33%;
`;

const QueryField = styled(Field)`
  padding-bottom: ${space(1)};
`;

const BuildSteps = styled(List)`
  gap: ${space(4)};
  max-width: 100%;
`;

const Body = styled(Layout.Body)`
  grid-template-rows: 1fr;
  && {
    gap: 0;
    padding: 0;
  }

  @media (max-width: ${p => p.theme.breakpoints[3]}) {
    grid-template-columns: 1fr;
  }

  @media (min-width: ${p => p.theme.breakpoints[2]}) {
    /* 325px + 16px + 16px to match Side component width, padding-left and padding-right */
    grid-template-columns: minmax(100px, auto) calc(325px + ${space(2) + space(2)});
  }

  @media (min-width: ${p => p.theme.breakpoints[3]}) {
    /* 325px + 16px + 30px to match Side component width, padding-left and padding-right */
    grid-template-columns: minmax(100px, auto) calc(325px + ${space(2) + space(4)});
  }
`;

const Main = styled(Layout.Main)`
  max-width: 1000px;
  flex: 1;

  padding: ${space(4)} ${space(2)};

  @media (min-width: ${p => p.theme.breakpoints[1]}) {
    padding: ${space(4)};
  }
`;

const Side = styled(Layout.Side)`
  padding: ${space(4)} ${space(2)};

  @media (min-width: ${p => p.theme.breakpoints[3]}) {
    border-left: 1px solid ${p => p.theme.gray200};

    /* to be consistent with Layout.Body in other verticals */
    padding-right: ${space(4)};
  }

  @media (max-width: ${p => p.theme.breakpoints[3]}) {
    border-top: 1px solid ${p => p.theme.gray200};
  }

  @media (max-width: ${p => p.theme.breakpoints[3]}) {
    grid-row: 2/2;
    grid-column: 1/1;
  }
`;

const MainWrapper = styled('div')`
  display: flex;
  flex-direction: column;
`;

import {Component, Fragment} from 'react';
import {RouteComponentProps} from 'react-router';

import Link from 'sentry/components/links/link';
import NavTabs from 'sentry/components/navTabs';
import SentryDocumentTitle from 'sentry/components/sentryDocumentTitle';
import {t} from 'sentry/locale';
import {Project} from 'sentry/types';
import recreateRoute from 'sentry/utils/recreateRoute';
import SettingsPageHeader from 'sentry/views/settings/components/settingsPageHeader';
import TextBlock from 'sentry/views/settings/components/text/textBlock';
import PermissionAlert from 'sentry/views/settings/project/permissionAlert';
import GroupTombstones from 'sentry/views/settings/project/projectFilters/groupTombstones';
import ProjectFiltersChart from 'sentry/views/settings/project/projectFilters/projectFiltersChart';
import ProjectFiltersSettings from 'sentry/views/settings/project/projectFilters/projectFiltersSettings';

type Props = {
  project: Project;
} & RouteComponentProps<{filterType: string; orgId: string; projectId: string}, {}>;

class ProjectFilters extends Component<Props> {
  render() {
    const {project, params, location} = this.props;
    const {orgId, projectId, filterType} = params;
    if (!project) {
      return null;
    }

    const features = new Set(project.features);

    return (
      <Fragment>
        <SentryDocumentTitle title={t('Inbound Filters')} projectSlug={projectId} />
        <SettingsPageHeader title={t('Inbound Data Filters')} />
        <PermissionAlert />

        <TextBlock>
          {t(
            'Filters allow you to prevent Sentry from storing events in certain situations. Filtered events are tracked separately from rate limits, and do not apply to any project quotas.'
          )}
        </TextBlock>

        <div>
          <ProjectFiltersChart project={project} params={this.props.params} />

          {features.has('discard-groups') && (
            <NavTabs underlined style={{paddingTop: '30px'}}>
              <li className={filterType === 'data-filters' ? 'active' : ''}>
                <Link to={recreateRoute('data-filters/', {...this.props, stepBack: -1})}>
                  {t('Data Filters')}
                </Link>
              </li>
              <li className={filterType === 'discarded-groups' ? 'active' : ''}>
                <Link
                  to={recreateRoute('discarded-groups/', {...this.props, stepBack: -1})}
                >
                  {t('Discarded Issues')}
                </Link>
              </li>
            </NavTabs>
          )}

          {filterType === 'discarded-groups' ? (
            <GroupTombstones orgId={orgId} projectId={project.slug} location={location} />
          ) : (
            <ProjectFiltersSettings
              project={project}
              params={this.props.params}
              features={features}
            />
          )}
        </div>
      </Fragment>
    );
  }
}

export default ProjectFilters;

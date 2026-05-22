import Link from 'next/link';
import { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  findRegionEvent,
  formatEventDate,
  formatEventTime,
  formatEventTimeRange,
  getAllEventStaticParams,
  hasEventEnded,
} from '@/utils/regionEvents';

interface EventPageParams {
  regionSlug: string;
  eventSlug: string;
}

export const dynamicParams = true;

export const generateStaticParams = async () => getAllEventStaticParams();

export async function generateMetadata({
  params,
}: {
  params: Promise<EventPageParams>;
}): Promise<Metadata> {
  const { regionSlug, eventSlug } = await params;
  const match = findRegionEvent(regionSlug, eventSlug);

  if (!match) {
    return {
      title: 'Event Not Found',
      description: 'We could not find the event you were looking for.',
    };
  }

  const {
    region: { regionName },
    event,
  } = match;

  const formattedDate = formatEventDate(event.date);
  const timeRange = formatEventTimeRange(event.startTime, event.endTime);

  const summary =
    event.summary ??
    event.headline ??
    `Details for ${event.title} on ${formattedDate}${
      timeRange ? ` at ${timeRange}` : ''
    }.`;

  return {
    title: `${event.title}${regionName ? ` | ${regionName}` : ''}`,
    description: summary,
    openGraph: {
      title: event.title,
      description: summary,
      type: 'article',
      locale: 'en_US',
      ...(event.image ? { images: [{ url: event.image }] } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: event.title,
      description: summary,
      ...(event.image ? { images: [event.image] } : {}),
    },
  };
}

export default async function EventPage({
  params,
}: {
  params: Promise<EventPageParams>;
}) {
  const { regionSlug, eventSlug } = await params;
  const match = findRegionEvent(regionSlug, eventSlug);

  if (!match) {
    notFound();
  }

  const { region, event } = match;
  const regionName =
    region.regionName ??
    `F3 ${region.regionSlug
      .split('-')
      .map(
        (segment) =>
          segment.charAt(0).toUpperCase() + segment.slice(1).toLowerCase()
      )
      .join(' ')}`;

  const formattedDate = formatEventDate(event.date);
  const timeRange = formatEventTimeRange(event.startTime, event.endTime);
  const eventHasEnded = hasEventEnded(event);

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="mb-6">
        <Link
          href={`/${regionSlug}`}
          className="inline-flex items-center text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
        >
          <svg
            className="w-5 h-5 mr-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 19l-7-7m0 0l7-7m-7 7h18"
            />
          </svg>
          Back to {regionName}
        </Link>
      </div>

      <article className="bg-white/90 dark:bg-gray-900/80 border border-gray-200 dark:border-gray-700 rounded-2xl shadow-lg overflow-hidden">
        <div className="px-6 py-8 md:px-10 md:py-10">
          <div className="uppercase tracking-widest text-sm font-semibold text-blue-600 dark:text-blue-300 mb-2">
            {formattedDate}
          </div>
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
            {event.title}
          </h1>
          {event.type ? (
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-100 dark:bg-blue-800/60 text-blue-800 dark:text-blue-100 text-sm font-semibold mb-6">
              {event.type}
            </div>
          ) : null}
          {event.headline ? (
            <p className="text-lg text-gray-600 dark:text-gray-300 mb-6">
              {event.headline}
            </p>
          ) : null}
          {event.summary ? (
            <p className="text-base text-gray-700 dark:text-gray-200 mb-6">
              {event.summary}
            </p>
          ) : null}

          <div className="grid md:grid-cols-2 gap-6 md:gap-8 mb-8">
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-100 dark:border-blue-800 rounded-xl p-5">
              <h2 className="text-lg font-semibold text-blue-900 dark:text-blue-100 mb-3">
                Event Details
              </h2>
              <dl className="space-y-3 text-sm md:text-base text-blue-900 dark:text-blue-100">
                {event.type ? (
                  <div>
                    <dt className="font-semibold">Workout Style</dt>
                    <dd>
                      <span className="inline-flex items-center px-3 py-1 rounded-full bg-white/70 dark:bg-blue-950/40 border border-blue-200/60 dark:border-blue-700/60 font-semibold">
                        {event.type}
                      </span>
                    </dd>
                  </div>
                ) : null}
                {timeRange ? (
                  <div>
                    <dt className="font-semibold">Time</dt>
                    <dd>{timeRange}</dd>
                  </div>
                ) : null}
                {event.location?.name || event.location?.address ? (
                  <div>
                    <dt className="font-semibold">Location</dt>
                    <dd className="space-y-0.5">
                      {event.location?.name ? (
                        <div>{event.location.name}</div>
                      ) : null}
                      {event.location?.address ? (
                        <div className="text-blue-700 dark:text-blue-200">
                          {event.location.url ? (
                            <a
                              href={event.location.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="hover:underline"
                            >
                              {event.location.address}
                            </a>
                          ) : (
                            event.location.address
                          )}
                        </div>
                      ) : null}
                      {event.location?.notes ? (
                        <div className="text-sm text-blue-800/80 dark:text-blue-200/80">
                          {event.location.notes}
                        </div>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {event.highlights && event.highlights.length > 0 ? (
              <div className="bg-gray-50 dark:bg-gray-800/60 border border-gray-200 dark:border-gray-700 rounded-xl p-5">
                <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-3">
                  Highlights
                </h2>
                <ul className="list-disc list-inside space-y-2 text-gray-700 dark:text-gray-200">
                  {event.highlights.map((highlight) => (
                    <li key={highlight}>{highlight}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {event.schedule && event.schedule.length > 0 ? (
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Schedule
              </h2>
              <div className="space-y-3">
                {event.schedule.map((item) => (
                  <div
                    key={`${item.label}-${item.time ?? 'time'}`}
                    className="flex flex-col md:flex-row md:items-baseline md:gap-6 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3"
                  >
                    <span className="text-sm font-mono text-blue-700 dark:text-blue-300 mb-1 md:mb-0 md:w-32">
                      {formatEventTime(item.time) ?? item.time ?? 'TBD'}
                    </span>
                    <span className="text-base text-gray-800 dark:text-gray-200 font-medium">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {event.contacts && event.contacts.length > 0 ? (
            <section className="mb-8">
              <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100 mb-4">
                Points of Contact
              </h2>
              <div className="grid md:grid-cols-2 gap-4">
                {event.contacts.map((contact) => (
                  <div
                    key={contact.name}
                    className="border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-3 bg-gray-50 dark:bg-gray-800/60"
                  >
                    <div className="text-base font-semibold text-gray-900 dark:text-gray-100">
                      {contact.name}
                    </div>
                    {contact.role ? (
                      <div className="text-sm text-gray-600 dark:text-gray-300">
                        {contact.role}
                      </div>
                    ) : null}
                    <div className="mt-2 space-y-1 text-sm text-gray-700 dark:text-gray-200">
                      {contact.email ? (
                        <div>
                          Email:{' '}
                          <a
                            href={`mailto:${contact.email}`}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                          >
                            {contact.email}
                          </a>
                        </div>
                      ) : null}
                      {contact.phone ? (
                        <div>
                          Phone:{' '}
                          <a
                            href={`tel:${contact.phone}`}
                            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-200"
                          >
                            {contact.phone}
                          </a>
                        </div>
                      ) : null}
                      {contact.slack ? <div>Slack: {contact.slack}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {event.cta && !eventHasEnded ? (
            <div className="mt-10">
              <a
                href={event.cta.url}
                className="inline-flex items-center px-6 py-3 rounded-full bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors shadow-lg"
              >
                {event.cta.label}
                <svg
                  className="w-5 h-5 ml-2"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 12h14M12 5l7 7-7 7"
                  />
                </svg>
              </a>
            </div>
          ) : null}
        </div>
      </article>
    </div>
  );
}

import {describe} from "node:test";
import {GenericContainer, StartedTestContainer, TestContainer, Wait} from "testcontainers";
import {EventStoreForDynamoDB} from "../event-store-for-dynamodb";
import {UserAccountId} from "./user-account-id";
import {UserAccount} from "./user-account";
import {UserAccountEvent} from "./user-account-event";
import {DynamoDBClient} from "@aws-sdk/client-dynamodb";
import {createDynamoDBClient, createJournalTable, createSnapshotTable} from "./dynamodb-utils";
import {ulid} from "ulid";
import {UserAccountRepository} from "./user-account-repository";

describe("UserAccountRepository", () => {
    let container: TestContainer;
    let startedContainer: StartedTestContainer;
    let eventStore: EventStoreForDynamoDB<
        UserAccountId,
        UserAccount,
        UserAccountEvent
    >;

    const JOURNAL_TABLE_NAME = "journal";
    const SNAPSHOT_TABLE_NAME = "snapshot";
    const JOURNAL_AID_INDEX_NAME = "journal-aid-index";
    const SNAPSHOTS_AID_INDEX_NAME = "snapshots-aid-index";

    function createEventStore(
        dynamodbClient: DynamoDBClient,
    ): EventStoreForDynamoDB<UserAccountId, UserAccount, UserAccountEvent> {
        return new EventStoreForDynamoDB<
            UserAccountId,
            UserAccount,
            UserAccountEvent
        >(
            dynamodbClient,
            JOURNAL_TABLE_NAME,
            SNAPSHOT_TABLE_NAME,
            JOURNAL_AID_INDEX_NAME,
            SNAPSHOTS_AID_INDEX_NAME,
            32,
        );
    }

    beforeAll(async () => {
        container = new GenericContainer("localstack/localstack:2.1.0")
            .withEnvironment({
                SERVICES: "dynamodb",
                DEFAULT_REGION: "us-west-1",
                EAGER_SERVICE_LOADING: "1",
                DYNAMODB_SHARED_DB: "1",
                DYNAMODB_IN_MEMORY: "1",
            })
            .withWaitStrategy(Wait.forLogMessage("Ready."))
            .withExposedPorts(4566);
        startedContainer = await container.start();
        const dynamodbClient = createDynamoDBClient(startedContainer);
        await createJournalTable(
            dynamodbClient,
            JOURNAL_TABLE_NAME,
            JOURNAL_AID_INDEX_NAME,
        );
        await createSnapshotTable(
            dynamodbClient,
            SNAPSHOT_TABLE_NAME,
            SNAPSHOTS_AID_INDEX_NAME,
        );
        eventStore = createEventStore(dynamodbClient);
    });

    afterAll(async () => {
        await startedContainer.stop();
    });

    test("storeAndFindById", async () => {

        const userAccountRepository = new UserAccountRepository(eventStore);

        const id = new UserAccountId(ulid());
        const name = "Alice";
        const [userAccount1, created] = UserAccount.create(id, name);

        await userAccountRepository.storeEventAndSnapshot(created, userAccount1);

        const [userAccount2, renamed] = userAccount1.rename("Bob");

        await userAccountRepository.storeEvent(renamed, userAccount2.version);

        const userAccount3 = await userAccountRepository.findById(id);
        if (userAccount3 === undefined) {
            throw new Error("userAccount3 is undefined");
        }

        expect(userAccount3.id).toEqual(id);
        expect(userAccount3.name).toEqual("Bob");
        expect(userAccount3.sequenceNumber).toEqual(2);
        expect(userAccount3.version).toEqual(2);
    });

});
